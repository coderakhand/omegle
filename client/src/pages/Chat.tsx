import * as mediasoupClient from "mediasoup-client";
import { useEffect, useRef, useState } from "react";
import { useSocket } from "../hooks/useSocket";

export default function Chat() {
  const socket = useSocket();

  const [device, setDevice] = useState<mediasoupClient.Device | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const [rtpCapabilities, setRtpCapabilities] = useState(null);

  useEffect(() => {
    if (!socket) return;

    socket.onmessage = async (event: MessageEvent) => {
      const message = JSON.parse(event.data);

      switch (message.type) {
        case "routerRtpCapabilities":
          setRtpCapabilities(message.payload);
          break;
      }
    };
  }, [socket, device]);

  return (
    <div className="min-h-screen min-w-screen py-[20px] px-[20px]">
      <div>
        <label htmlFor="receiverVideo"> Receiver</label>
        <video ref={remoteVideoRef} id="remoteVideo" autoPlay playsInline />
        <label htmlFor="senderVideo"> Sender</label>
        <video ref={videoRef} id="localVideo" autoPlay playsInline />
      </div>
      <div className="w-full min-h-screen">
        <div className="grid grid-cols-6 h-[30px] w-full">
          <input type="text" className="col-span-5" />
          <button className="col-span-1 bg-green-500 text-white">Send</button>
        </div>
      </div>
    </div>
  );
}
