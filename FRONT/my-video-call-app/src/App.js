import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';

const socket = io('http://localhost:8080'); // Dirección del servidor WebSocket

const VideoCall = () => {
  const [peerConnections, setPeerConnections] = useState({});
  const [mediaStream, setMediaStream] = useState(null);
  const [roomId, setRoomId] = useState(''); // ID de la sala
  const [usersInRoom, setUsersInRoom] = useState([]);
  const [videoDevices, setVideoDevices] = useState([]); // Estado para almacenar los dispositivos de video
  const localVideoRef = useRef(null);
  const userId = useRef(`user-${Math.floor(Math.random() * 1000)}`);

  const pendingCandidates = useRef({});

  const handleOffer = async (offer, userId) => {
    let pc = peerConnections[userId];
    if (!pc) {
      pc = initPeerConnection(userId);
    }
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', answer, roomId, userId);

    // Process any pending candidates
    if (pendingCandidates.current[userId]) {
      pendingCandidates.current[userId].forEach((candidate) => {
        pc.addIceCandidate(new RTCIceCandidate(candidate));
      });
      delete pendingCandidates.current[userId];
    }
  };

  const handleAnswer = (answer, userId) => {
    const pc = peerConnections[userId];
    if (pc) {
      pc.setRemoteDescription(new RTCSessionDescription(answer));
    } else {
      console.error(`No se encontró la conexión para el usuario ${userId}`);
    }
  };

  const handleICECandidate = (event, userId) => {
    if (event.candidate) {
      socket.emit('ice-candidate', event.candidate, roomId, userId);
    }
  };

  const handleNewICECandidate = (candidate, userId) => {
    const pc = peerConnections[userId];
    if (pc && pc.remoteDescription) {
      pc.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
      if (!pendingCandidates.current[userId]) {
        pendingCandidates.current[userId] = [];
      }
      pendingCandidates.current[userId].push(candidate);
    }
  };

  const handleTrack = (event, userId) => {
    const videoElement = document.getElementById(`remote-video-${userId}`);
    if (videoElement) {
      videoElement.srcObject = event.streams[0];
    }
  };

  const initPeerConnection = (userId) => {
    if (peerConnections[userId]) {
      return peerConnections[userId];
    }

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], // Servidor STUN
    });

    pc.onicecandidate = (event) => handleICECandidate(event, userId);
    pc.ontrack = (event) => handleTrack(event, userId);

    setPeerConnections((prevConnections) => ({
      ...prevConnections,
      [userId]: pc,
    }));

    return pc;
  };

  const joinRoom = () => {
    if (roomId) {
      socket.emit('join-room', roomId, userId.current);
      startCall(roomId);
    }
  };

  const createRoom = () => {
    const newRoomId = `room-${Math.floor(Math.random() * 1000)}`;
    setRoomId(newRoomId);
    socket.emit('join-room', newRoomId, userId.current);
    startCall(newRoomId);
  };

  const startCall = async (roomId) => {
    if (!mediaStream) {
      try {
        const stream = await getMediaStream();
        if (stream) {
          setMediaStream(stream);
          localVideoRef.current.srcObject = stream;
          const pc = initPeerConnection(userId.current);
          stream.getTracks().forEach((track) => pc.addTrack(track, stream));
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('offer', offer, roomId, userId.current);
        } else {
          console.error('No se pudo acceder a la cámara');
        }
      } catch (error) {
        console.error('Error al obtener el flujo de medios:', error);
      }
    }
  };

  const getVideoDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((device) => device.kind === 'videoinput');
      setVideoDevices(videoDevices); // Actualizamos el estado con los dispositivos de video encontrados
    } catch (error) {
      console.error('Error al obtener los dispositivos de video:', error);
    }
  };

  const getMediaStream = async () => {
    let stream = null;
    try {
      if (videoDevices.length > 0) {
        stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: videoDevices[0]?.deviceId }, audio: true });
      }
      checkStream(stream);
    } catch (error) {
      console.error('Error al acceder a la cámara', error);
      alert('No se pudo acceder a la cámara. Intente con otro dispositivo.');
      if (videoDevices.length > 1) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: videoDevices[1].deviceId } }, audio: true });
          checkStream(stream);
        } catch (error) {
          console.error('Error al acceder al segundo dispositivo', error);
        }
      }
    }
    return stream;
  };

  const checkStream = (stream) => {
    if (!stream) {
      console.error('No se pudo cargar la cámara');
      alert('No se pudo acceder a la cámara. Intente con otro dispositivo.');
    }
  };

  useEffect(() => {
    socket.on('connect', () => {
      console.log('Conectado al servidor WebSocket');
    });

    socket.on('user-connected', async (userId) => {
      console.log(userId);
      setUsersInRoom((prevUsers) => [...prevUsers, userId]);
      const pc = initPeerConnection(userId);
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => pc.addTrack(track, mediaStream));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', offer, roomId, userId);
      }
    });

    socket.on('existing-users', async (existingUsers) => {
      // Refrescar la lista de usuarios existentes
      setUsersInRoom(existingUsers);

      // Para cada usuario, obtener el flujo de medios y agregarlo
      for (const userId of existingUsers) {
        const pc = initPeerConnection(userId);
        if (mediaStream) {
          mediaStream.getTracks().forEach((track) => pc.addTrack(track, mediaStream));
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('offer', offer, roomId, userId);
        }
      }
    });

    socket.on('user-disconnected', (userId) => {
      setUsersInRoom((prevUsers) => prevUsers.filter((user) => user !== userId));
      if (peerConnections[userId]) {
        peerConnections[userId].close();
        setPeerConnections((prevConnections) => {
          const updatedConnections = { ...prevConnections };
          delete updatedConnections[userId];
          return updatedConnections;
        });
      }
    });

    socket.on('offer', handleOffer);
    socket.on('answer', handleAnswer);
    socket.on('ice-candidate', handleNewICECandidate);

    socket.on('users-in-room', (users) => {
      setUsersInRoom(users); // Actualizar los usuarios conectados en la sala
    });

    getVideoDevices(); // Obtener dispositivos de video cuando el componente se monte

    return () => {
      socket.off('connect');
      socket.off('user-connected');
      socket.off('user-disconnected');
      socket.off('offer');
      socket.off('answer');
      socket.off('ice-candidate');
      socket.off('users-in-room');
    };
  }, [mediaStream]);

  return (
    <div>
      <div>
        <h2>Video Call</h2>
        <button onClick={createRoom}>Crear Sala</button>
        <button onClick={joinRoom}>Unirse a Sala</button>

        <input type="text" value={roomId} onChange={(e) => setRoomId(e.target.value)} placeholder="Ingrese el ID de la sala" />
      </div>
      <div>
        <video ref={localVideoRef} autoPlay muted></video>
        {usersInRoom.map((userId) => (
          <video key={userId} id={`remote-video-${userId}`} autoPlay></video>
        ))}
      </div>
    </div>
  );
};

export default VideoCall;
