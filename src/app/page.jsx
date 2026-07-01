"use client";

import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export default function Home() {
  const [status, setStatus] = useState("Connecting to Server...");
  const [roomId, setRoomId] = useState("");
  const [hasJoinedRoom, setHasJoinedRoom] = useState(false);
  const [isInCall, setIsInCall] = useState(false);
  const [incomingCall, setIncomingCall] = useState(false);
  
  const socketRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const roomIdRef = useRef(""); // To access latest roomId inside callbacks

  // Keep ref in sync with state
  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    // 1. Initialize Socket.IO
    socketRef.current = io();

    socketRef.current.on("connect", () => {
      setStatus("Connected. Please enter a Room Code.");
    });

    socketRef.current.on("user-joined", () => {
      setStatus("Another user joined! Ready to Call");
    });

    // 2. Handle incoming WebRTC signaling
    socketRef.current.on("offer", async (offer) => {
      setIncomingCall(true);
      setStatus("Incoming Call...");
      await createPeerConnection();
      await peerConnectionRef.current?.setRemoteDescription(new RTCSessionDescription(offer));
    });

    socketRef.current.on("answer", async (answer) => {
      setStatus("In Call");
      setIsInCall(true);
      await peerConnectionRef.current?.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socketRef.current.on("ice-candidate", async (candidate) => {
      try {
        if (peerConnectionRef.current && candidate) {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (e) {
        console.error("Error adding received ice candidate", e);
      }
    });

    socketRef.current.on("end-call", () => {
      // The other person hung up, so we should clean up our side without emitting
      cleanupCall(false);
    });

    return () => {
      socketRef.current?.disconnect();
      cleanupCall(false);
    };
  }, []);

  const handleJoinRoom = () => {
    if (roomId.trim() && socketRef.current) {
      socketRef.current.emit("join-room", roomId);
      setHasJoinedRoom(true);
      setStatus(`Joined Room: ${roomId}. Waiting to call...`);
    }
  };

  const createPeerConnection = async () => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnectionRef.current = pc;

    // Send any ice candidates to the other peer
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit("ice-candidate", {
          roomId: roomIdRef.current,
          candidate: event.candidate,
        });
      }
    };

    // When remote track arrives, play it in the audio element
    pc.ontrack = (event) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = event.streams[0];
        remoteAudioRef.current.play().catch(e => console.error("Autoplay blocked:", e));
      }
    };

    // Monitor connection state to detect mobile network blocks
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "connected") {
        setStatus("Call Connected Successfully! 🟢");
      } else if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
        setStatus("Network Blocked: Try same Wi-Fi (TURN needed) 🔴");
      }
    };

    // Get microphone access
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });
    } catch (err) {
      console.error("Failed to get local stream", err);
      setStatus("Microphone access denied");
    }
  };

  const startCall = async () => {
    setStatus("Calling...");
    await createPeerConnection();

    const pc = peerConnectionRef.current;
    if (pc) {
      // Force WebRTC to receive audio even if the PC doesn't have a mic to send
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      socketRef.current?.emit("offer", {
        roomId: roomIdRef.current,
        offer,
      });
    }
  };

  const answerCall = async () => {
    setStatus("In Call");
    setIsInCall(true);
    setIncomingCall(false);

    const pc = peerConnectionRef.current;
    if (pc) {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current?.emit("answer", {
        roomId: roomIdRef.current,
        answer,
      });
    }
  };

  const endCall = () => {
    // We clicked the end button, so tell the other person we hung up
    socketRef.current?.emit("end-call", roomIdRef.current);
    cleanupCall(true);
  };

  const cleanupCall = (wasInitiator) => {
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }

    setIsInCall(false);
    setIncomingCall(false);
    setStatus(wasInitiator ? `You ended the call. Joined Room: ${roomIdRef.current}` : `The other person hung up. Joined Room: ${roomIdRef.current}`);
  };

  // Determine badge class based on status
  let badgeClass = "status-badge";
  if (status.includes("Connected") || status.includes("Ready") || status.includes("Joined")) badgeClass += " connected";
  else if (status.includes("Call")) badgeClass += " calling";

  return (
    <div className="container">
      <h1>WebRTC Voice Call</h1>
      <p className="subtitle">Simple Peer-to-Peer Audio</p>

      <div className={badgeClass}>{status}</div>

      {!hasJoinedRoom ? (
        <div className="room-setup">
          <input 
            type="text" 
            placeholder="Enter Room Code (e.g. 1234)" 
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="room-input"
          />
          <button className="btn-primary" onClick={handleJoinRoom} disabled={!roomId.trim()}>
            Join Room
          </button>
        </div>
      ) : (
        <div className="controls">
          {!isInCall && !incomingCall && (
            <button className="btn-primary" onClick={startCall}>
              🎤 Call
            </button>
          )}

          {incomingCall && !isInCall && (
            <button className="btn-success" onClick={answerCall}>
              📞 Answer
            </button>
          )}

          {isInCall && (
            <button className="btn-danger" onClick={endCall}>
              ❌ End Call
            </button>
          )}
        </div>
      )}

      <div className={`audio-visualizer ${isInCall ? "active" : ""}`}>
        <div className="bar"></div>
        <div className="bar"></div>
        <div className="bar"></div>
        <div className="bar"></div>
        <div className="bar"></div>
      </div>

      <audio ref={remoteAudioRef} autoPlay playsInline />
    </div>
  );
}
