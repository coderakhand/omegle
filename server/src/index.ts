import express from "express";
import http from "http";
import { Server } from "socket.io";
import * as mediasoup from "mediasoup";
import type {
  Worker,
  Router,
  WebRtcTransport,
  Producer,
  Consumer,
  RtpCodecCapability,
  DtlsParameters,
} from "mediasoup/node/lib/types";


const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});
const peers = io.of("/mediasoup");


let worker: Worker;
let router: Router;

const mediaCodecs: RtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000,
    },
  },
];

interface Peer {
  producerTransport?: WebRtcTransport;
  consumerTransport?: WebRtcTransport;
  producer?: Producer;
  consumer?: Consumer;
}
const peersMap = new Map<string, Peer>();


async function createWorker() {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
  });

  worker.on("died", () => {
    console.error("mediasoup worker died");
    setTimeout(() => process.exit(1), 2000);
  });
}


async function createWebRtcTransport(): Promise<WebRtcTransport> {
  const transport = await router.createWebRtcTransport({
    listenIps: [{ ip: "127.0.0.1" }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });

  transport.on("dtlsstatechange", (state) => {
    if (state === "closed") transport.close();
  });

  return transport;
}


async function startServer() {
  await createWorker();
  router = await worker.createRouter({ mediaCodecs });

  peers.on("connection", (socket) => {
    console.log(`Client connected: ${socket.id}`);
    peersMap.set(socket.id, {});
    socket.emit("connection-success", { socketId: socket.id });

    socket.on("disconnect", () => {
      console.log(`Client disconnected: ${socket.id}`);
      peersMap.delete(socket.id);
    });

    socket.on("getRouterRtpCapabilities", (callback) => {
      callback({ routerRtpCapabilities: router.rtpCapabilities });
    });

    socket.on("createTransport", async ({ sender }, callback) => {
      const transport = await createWebRtcTransport();
      const peer = peersMap.get(socket.id);
      if (!peer) return;

      if (sender) peer.producerTransport = transport;
      else peer.consumerTransport = transport;

      callback({
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        },
      });
    });

    socket.on("connectProducerTransport", async ({ dtlsParameters }) => {
      const peer = peersMap.get(socket.id);
      await peer?.producerTransport?.connect({ dtlsParameters });
    });

    socket.on(
      "transport-produce",
      async ({ kind, rtpParameters }, callback) => {
        const peer = peersMap.get(socket.id);
        const producer = await peer?.producerTransport?.produce({
          kind,
          rtpParameters,
        });
        if (producer) peer!.producer = producer;

        producer?.on("transportclose", () => producer.close());
        callback({ id: producer?.id });
      }
    );

    socket.on("connectConsumerTransport", async ({ dtlsParameters }) => {
      const peer = peersMap.get(socket.id);
      await peer?.consumerTransport?.connect({ dtlsParameters });
    });

    socket.on("consumeMedia", async ({ rtpCapabilities }, callback) => {
      const peer = peersMap.get(socket.id);
      const producer = [...peersMap.values()].find((p) => p.producer)?.producer;
      if (
        !producer ||
        !router.canConsume({ producerId: producer.id, rtpCapabilities })
      ) {
        callback({ params: { error: "Cannot consume" } });
        return;
      }

      const consumer = await peer?.consumerTransport?.consume({
        producerId: producer.id,
        rtpCapabilities,
        paused: false,
      });

      peer!.consumer = consumer;

      consumer?.on("transportclose", () => consumer.close());
      consumer?.on("producerclose", () => consumer.close());

      callback({
        params: {
          producerId: producer.id,
          id: consumer?.id,
          kind: consumer?.kind,
          rtpParameters: consumer?.rtpParameters,
        },
      });
    });

    socket.on("resumePausedConsumer", async () => {
      const peer = peersMap.get(socket.id);
      await peer?.consumer?.resume();
    });
  });

  const PORT = 3000;
  server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

startServer();
