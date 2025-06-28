import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { Device } from "mediasoup-client";
import type {
  Transport,
  DtlsParameters,
  RtpCapabilities,
} from "mediasoup-client/types";

export default function Chat() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const [socket, setSocket] = useState<Socket | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [producerTransport, setProducerTransport] = useState<Transport | null>(
    null
  );
  const [consumerTransport, setConsumerTransport] = useState<Transport | null>(
    null
  );
  const [rtpCapabilities, setRtpCapabilities] =
    useState<RtpCapabilities | null>(null);
  const [track, setTrack] = useState<MediaStreamTrack | null>(null);

  useEffect(() => {
    const s = io("http://192.168.206.169:3000/mediasoup");
    setSocket(s);
    s.on("connection-success", startCamera);
    return () => {
      s.disconnect();
    };
  }, []);

  const startCamera = async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((d) => d.kind === "videoinput");


    console.log("Available cameras:", cameras);

    const physicalCamera = cameras.find(
      (cam) =>
        !cam.label.toLowerCase().includes("obs") &&
        !cam.label.toLowerCase().includes("virtual")
    );

    const deviceId = physicalCamera?.deviceId || cameras[0]?.deviceId;

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId } },
    });
    if (videoRef.current) videoRef.current.srcObject = stream;
    const videoTrack = stream.getVideoTracks()[0];
    setTrack(videoTrack);
  };

  const getRouterRtpCapabilities = async (): Promise<void> => {
    return new Promise((resolve) => {
      socket?.emit("getRouterRtpCapabilities", (data: any) => {
        setRtpCapabilities(data.routerRtpCapabilities);
        resolve();
      });
    });
  };

  const createDevice = async () => {
    if (!rtpCapabilities) return;
    const newDevice = new Device();
    await newDevice.load({ routerRtpCapabilities: rtpCapabilities });
    setDevice(newDevice);
  };

  const createSendTransport = async (): Promise<Transport | null> => {
    return new Promise((resolve) => {
      socket?.emit(
        "createTransport",
        { sender: true },
        async ({ params }: any) => {
          if (!device) return resolve(null);
          const transport = device.createSendTransport(params);

          transport.on(
            "connect",
            (
              { dtlsParameters }: { dtlsParameters: DtlsParameters },
              callback,
              errback
            ) => {
              socket.emit("connectProducerTransport", { dtlsParameters });
              callback();
            }
          );

          transport.on(
            "produce",
            ({ kind, rtpParameters }: any, callback, errback) => {
              socket.emit(
                "transport-produce",
                { kind, rtpParameters },
                ({ id }: any) => {
                  callback({ id });
                }
              );
            }
          );

          setProducerTransport(transport);
          resolve(transport);
        }
      );
    });
  };

  const connectSendTransport = async (transport: Transport) => {
    if (!track) return;
    const producer = await transport.produce({
      track,
      encodings: [
        { rid: "r0", maxBitrate: 100_000, scalabilityMode: "S1T3" },
        { rid: "r1", maxBitrate: 300_000, scalabilityMode: "S1T3" },
        { rid: "r2", maxBitrate: 900_000, scalabilityMode: "S1T3" },
      ],
      codecOptions: { videoGoogleStartBitrate: 1000 },
    });

    producer.on("trackended", () => console.log("track ended"));
    producer.on("transportclose", () => console.log("transport closed"));
  };

  const createRecvTransport = async (): Promise<Transport | null> => {
    return new Promise((resolve) => {
      socket?.emit(
        "createTransport",
        { sender: false },
        async ({ params }: any) => {
          if (!device) return resolve(null);
          const transport = device.createRecvTransport(params);

          transport.on(
            "connect",
            ({ dtlsParameters }: any, callback: any, errback: any) => {
              socket.emit("connectConsumerTransport", { dtlsParameters });
              callback();
            }
          );

          setConsumerTransport(transport);
          resolve(transport);
        }
      );
    });
  };

  const connectRecvTransport = async (transport: Transport) => {
    socket?.emit(
      "consumeMedia",
      { rtpCapabilities: device?.rtpCapabilities },
      async ({ params }: any) => {
        if (params.error) {
          console.error(params.error);
          return;
        }

        const consumer = await transport.consume({
          id: params.id,
          producerId: params.producerId,
          kind: params.kind,
          rtpParameters: params.rtpParameters,
        });

        const stream = new MediaStream();
        stream.addTrack(consumer.track);

        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;

        socket.emit("resumePausedConsumer");
      }
    );
  };

  const handleConnect = async () => {
    await getRouterRtpCapabilities();
    await createDevice();
    const sendTransport = await createSendTransport();
    if (sendTransport) await connectSendTransport(sendTransport);
    const recvTransport = await createRecvTransport();
    if (recvTransport) await connectRecvTransport(recvTransport);
  };

  return (
    <div className="min-h-screen min-w-screen flex flex-col items-center justify-center gap-4 bg-black text-white p-4">
      <div className="flex gap-8">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-64 h-48 bg-gray-800"
        />
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-64 h-48 bg-gray-800"
        />
      </div>
      <button
        onClick={handleConnect}
        className="px-6 py-2 bg-green-500 hover:bg-green-600 rounded-lg text-lg font-semibold"
      >
        Connect
      </button>
    </div>
  );
}
