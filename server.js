// server.js
// Basic WebSocket signaling server for a two-party WebRTC video call.
// Uses the 'ws' module for Node.js to handle WebSocket connections.
// This server facilitates the exchange of WebRTC metadata (SDP offers/answers, ICE candidates)
// between two peers to establish a direct peer-to-peer connection.

const WebSocket = require('ws');

// Define the port the WebSocket server will listen on.
// Uses the PORT environment variable if set (e.g., by a hosting provider),
// otherwise defaults to 8080.
// IMPORTANT: If this port is changed, the WEBSOCKET_URL in script.js must also be updated.
const PORT = process.env.PORT || 8080;

// Create a new WebSocket server instance.
// The server will listen for incoming connections on the specified PORT.
const wss = new WebSocket.Server({ port: PORT });

/**
 * In-memory store for active signaling sessions.
 * Each key is a unique `sessionId`.
 * Each value is an object representing a session, with properties:
 *  - `initiator`: The WebSocket connection object (`ws`) of the peer who created the session.
 *  - `receiver`: The WebSocket connection object (`ws`) of the peer who joined the session. Initially null.
 *
 * Example:
 * sessions = {
 *   "abcdef": { initiator: wsObject1, receiver: null },
 *   "uvwxyz": { initiator: wsObject2, receiver: wsObject3 }
 * }
 * This simple structure is suitable for a two-peer call. For multi-party calls,
 * a more complex session management system would be needed.
 */
const sessions = {};

console.log(`Signaling server started on ws://localhost:${PORT}`);

// Event listener for new WebSocket connections.
// This function is executed each time a new client connects to the server.
wss.on('connection', ws => {
    // `ws` is the WebSocket object representing the connection to this specific client.
    console.log('Client connected');

    // Event listener for messages received from this client.
    ws.on('message', messageString => {
        let message;
        try {
            // Attempt to parse the incoming message string as JSON.
            // All signaling messages are expected to be in JSON format.
            message = JSON.parse(messageString);
            console.log('Received message:', message);
        } catch (error) {
            console.error('Failed to parse message or invalid JSON:', messageString);
            // Send an error message back to the client if JSON parsing fails.
            ws.send(JSON.stringify({ type: 'sessionError', message: 'Invalid JSON message format.' }));
            return;
        }

        // Determine the sessionId for the current operation.
        // If the message includes a sessionId (e.g., for 'joinSession', 'offer', 'answer', 'iceCandidate'), use that.
        // Otherwise, if the ws object already has a sessionId (set during 'createSession' or 'joinSession'), use that.
        const sessionId = message.sessionId || ws.sessionId;

        // Handle different types of messages based on `message.type`.
        switch (message.type) {
            case 'createSession':
                // Handles a request from a client to create a new signaling session.
                const newSessionId = generateUniqueId(); // Generate a unique ID for the new session.
                ws.sessionId = newSessionId; // Store the sessionId on the WebSocket object for future reference.
                
                // Create a new session entry in the `sessions` store.
                // The client sending 'createSession' becomes the 'initiator'.
                sessions[newSessionId] = {
                    initiator: ws,
                    receiver: null, // The 'receiver' peer has not joined yet.
                };
                console.log(`Session created: ${newSessionId} by initiator.`);
                // Send a 'sessionCreated' message back to the initiator with the new sessionId.
                ws.send(JSON.stringify({ type: 'sessionCreated', sessionId: newSessionId }));
                break;

            case 'joinSession':
                // Handles a request from a client to join an existing signaling session.
                const sessionToJoinId = message.sessionId;
                const sessionToJoin = sessions[sessionToJoinId];

                if (sessionToJoin) {
                    // Check if the session already has a receiver.
                    if (sessionToJoin.receiver) {
                        console.warn(`Session ${sessionToJoinId} is already full.`);
                        ws.send(JSON.stringify({ type: 'sessionError', message: 'Session is full.' }));
                    } 
                    // Prevent the initiator from joining their own session as a receiver.
                    else if (sessionToJoin.initiator === ws) {
                         console.warn(`Initiator cannot join their own session as receiver: ${sessionToJoinId}`);
                         ws.send(JSON.stringify({ type: 'sessionError', message: 'You cannot join your own session as receiver.'}));
                    }
                    // If the session is valid and available for joining.
                    else {
                        ws.sessionId = sessionToJoinId; // Store the sessionId on this client's WebSocket object.
                        sessionToJoin.receiver = ws; // Assign this client as the 'receiver' in the session.
                        console.log(`Receiver joined session: ${sessionToJoinId}`);

                        // Notify both the initiator and the receiver that the session is now complete with two peers.
                        // The `peerRole` helps the client-side logic determine if it should initiate the offer or wait for one.
                        if (sessionToJoin.initiator && sessionToJoin.initiator.readyState === WebSocket.OPEN) {
                            sessionToJoin.initiator.send(JSON.stringify({ type: 'userJoined', sessionId: sessionToJoinId, peerRole: 'initiator' }));
                        }
                        if (sessionToJoin.receiver && sessionToJoin.receiver.readyState === WebSocket.OPEN) {
                            sessionToJoin.receiver.send(JSON.stringify({ type: 'userJoined', sessionId: sessionToJoinId, peerRole: 'receiver' }));
                        }
                    }
                } else {
                    // If the specified sessionId does not exist.
                    console.warn(`Session not found: ${sessionToJoinId}`);
                    ws.send(JSON.stringify({ type: 'sessionError', message: 'Session ID not found.' }));
                }
                break;

            case 'offer':       // WebRTC SDP offer message
            case 'answer':      // WebRTC SDP answer message
            case 'iceCandidate':// WebRTC ICE candidate message
                // These messages are critical for WebRTC peer connection setup and need to be relayed
                // from the sender to the other peer in the same session.
                
                // Ensure the session exists. The `sessionId` should have been set on `ws.sessionId`
                // when the client created or joined a session, or it's part of the message itself.
                if (!sessionId || !sessions[sessionId]) {
                    console.warn(`Cannot process ${message.type}: Session ${sessionId} not found for this client.`);
                    ws.send(JSON.stringify({ type: 'sessionError', message: `Cannot process ${message.type}. Session not found or client not properly joined.` }));
                    return;
                }
                const currentSessionForRelay = sessions[sessionId];
                
                // Determine the recipient of the message (the other peer in the session).
                // If the sender is the initiator, the recipient is the receiver, and vice-versa.
                const otherPeer = currentSessionForRelay.initiator === ws ? currentSessionForRelay.receiver : currentSessionForRelay.initiator;

                if (otherPeer && otherPeer.readyState === WebSocket.OPEN) {
                    // Relay the message directly to the other peer.
                    // The message content (SDP offer/answer or ICE candidate) is passed through unmodified.
                    console.log(`Relaying ${message.type} from peer in session ${sessionId} to other peer.`);
                    otherPeer.send(JSON.stringify(message));
                } else {
                    // If the other peer is not available (e.g., disconnected or not yet joined).
                    console.warn(`Cannot relay ${message.type}: Other peer not found or not connected in session ${sessionId}.`);
                    // Notify the sender that the message could not be delivered.
                    ws.send(JSON.stringify({ type: 'sessionError', message: 'Other peer is not available to receive the message.' }));
                }
                break;

            default:
                // Handle any unknown message types.
                console.warn('Unknown message type received:', message.type);
                ws.send(JSON.stringify({ type: 'sessionError', message: `Unknown message type: ${message.type}`}));
        }
    });

    // Event listener for when this client's WebSocket connection is closed.
    ws.on('close', () => {
        console.log('Client disconnected');
        // Retrieve the sessionId associated with the disconnected client.
        const sessionIdOnClose = ws.sessionId; 
        if (sessionIdOnClose && sessions[sessionIdOnClose]) {
            const sessionOnClose = sessions[sessionIdOnClose];
            // Identify the other peer in the session.
            const otherPeer = sessionOnClose.initiator === ws ? sessionOnClose.receiver : sessionOnClose.initiator;

            if (otherPeer && otherPeer.readyState === WebSocket.OPEN) {
                // If the other peer is still connected, notify them that this user has left.
                console.log(`Notifying other peer in session ${sessionIdOnClose} about disconnection.`);
                otherPeer.send(JSON.stringify({ type: 'userLeft', sessionId: sessionIdOnClose }));
            }
            
            // Clean up the session: remove it from the `sessions` store.
            // This makes the sessionId available again or simply frees resources.
            delete sessions[sessionIdOnClose];
            console.log(`Session ${sessionIdOnClose} cleaned up.`);
        }
    });

    // Event listener for WebSocket errors related to this client's connection.
    ws.on('error', (error) => {
        console.error('WebSocket error for a client:', error);
        // Additional error handling could be implemented here, such as:
        // - Ensuring session cleanup if `ws.sessionId` is defined.
        // - Logging more detailed error information.
    });
});

/**
 * Generates a simple, relatively unique ID for sessions.
 * This implementation creates a 6-character alphanumeric ID from a random number.
 * For a production application, a more robust UUID (Universally Unique Identifier)
 * generator (e.g., using a library like `uuid`) would be recommended to ensure global uniqueness
 * and reduce the extremely small chance of collisions.
 * @returns {string} A pseudo-random 6-character string.
 */
function generateUniqueId() {
    return Math.random().toString(36).substr(2, 6);
}

// Basic check to ensure the 'ws' module (WebSocket library) is installed.
// If 'ws' cannot be resolved, it means it's likely not installed in node_modules.
try {
    require.resolve('ws');
} catch(e) {
    console.error("The 'ws' module is not installed. Please run 'npm install ws' or 'yarn add ws'.");
    process.exit(e.code); // Exit the server process if the dependency is missing.
}
