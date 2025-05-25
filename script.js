// Get HTML elements for video display and call controls.
// These elements are the interface for the user to interact with the video call application.
const localVideo = document.getElementById('localVideo'); // Displays the user's own video stream.
const remoteVideo = document.getElementById('remoteVideo'); // Displays the video stream from the remote peer.

// New UI elements for WebSocket-based signaling.
// These replace the previous manual signaling UI.
const createCallButton = document.getElementById('createCallButton'); // Button to initiate a new call session.
const joinCallButton = document.getElementById('joinCallButton'); // Button to join an existing call session using a session ID.
const sessionIdInput = document.getElementById('sessionIdInput'); // Input field for entering the session ID to join.
const callIdDisplay = document.getElementById('callIdDisplay'); // Displays the generated session ID for a new call.
const callStatus = document.getElementById('callStatus'); // Displays status messages to the user (e.g., "Waiting...", "Connected").

const hangupButton = document.getElementById('hangupButton'); // Button to end the current call.

// Global variables for managing WebRTC and WebSocket state.
let localStream; // Holds the user's local audio/video stream (MediaStream object).
// `remoteStream` is implicitly handled by `peerConnection.ontrack` which directly sets the `remoteVideo.srcObject`.
let peerConnection; // The RTCPeerConnection object managing the peer-to-peer connection.
let websocket; // The WebSocket object for communication with the signaling server.
let currentSessionId; // Stores the ID of the current call session, used for signaling messages.
let localPeerRole; // Indicates the role of this client in the session: 'initiator' or 'receiver'.

// STUN server configuration.
// STUN (Session Traversal Utilities for NAT) servers are used to discover the client's public IP address
// and the type of NAT it is behind. This is crucial for establishing a peer-to-peer connection.
// Google's public STUN server is used here. For production, you might use multiple or your own.
const configuration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// WebSocket server URL.
// This URL must point to the running WebSocket signaling server (server.js).
// IMPORTANT: If the server's port (in server.js) is changed, this URL must also be updated.
const WEBSOCKET_URL = 'ws://localhost:8080'; // Defaulting to localhost on port 8080.

/**
 * Initializes the application.
 * This function is called when the script loads. It sets up initial UI states
 * and attaches event listeners to the control buttons.
 * Changes from manual signaling: Event listeners are now for WebSocket-based call controls.
 */
function initialize() {
    console.log('Initializing application for WebSocket signaling...');

    // Attach event listeners to the call control buttons.
    createCallButton.addEventListener('click', handleCreateCall);
    joinCallButton.addEventListener('click', handleJoinCall);
    hangupButton.addEventListener('click', hangUpCall);

    // Set initial UI states:
    // - Hangup button is disabled as there's no active call.
    // - Create and Join buttons are enabled.
    // - Session ID input is enabled.
    // - Initial status message is displayed.
    hangupButton.disabled = true;
    createCallButton.disabled = false;
    joinCallButton.disabled = false;
    sessionIdInput.disabled = false;
    callStatus.textContent = 'Ready to create or join a call.';
}

/**
 * Establishes a WebSocket connection to the signaling server.
 * This function is asynchronous and returns a Promise that resolves when the connection
 * is successfully opened, or rejects if an error occurs.
 * It sets up event handlers for 'open', 'message', 'error', and 'close' events on the WebSocket.
 */
function connectWebSocket() {
    // If WebSocket is already connected and open, resolve immediately.
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        console.log('WebSocket already connected.');
        return Promise.resolve();
    }
    
    // Return a promise that resolves on successful connection or rejects on error.
    return new Promise((resolve, reject) => {
        websocket = new WebSocket(WEBSOCKET_URL); // Create a new WebSocket instance.

        /**
         * WebSocket 'onopen' event handler.
         * Called when the WebSocket connection is successfully established.
         */
        websocket.onopen = () => {
            console.log('WebSocket connection established.');
            callStatus.textContent = 'Connected to signaling server.';
            resolve(); // Resolve the promise indicating successful connection.
        };

        /**
         * WebSocket 'onmessage' event handler.
         * Called when a message is received from the signaling server.
         * The message is parsed as JSON and processed based on its `type` property.
         * @param {MessageEvent} event - The event object containing the received message data.
         */
        websocket.onmessage = async (event) => {
            const message = JSON.parse(event.data); // Parse the JSON message from the server.
            console.log('WebSocket message received:', message);

            // Handle different message types from the server.
            switch (message.type) {
                case 'sessionCreated':
                    // Server confirms session creation. This client is the 'initiator'.
                    currentSessionId = message.sessionId; // Store the assigned session ID.
                    localPeerRole = 'initiator'; // Set role.
                    callIdDisplay.textContent = `Your Call ID: ${currentSessionId}`; // Display the Call ID.
                    callStatus.textContent = `Call ID ${currentSessionId}. Waiting for another user to join...`;
                    // As initiator, set up local media and PeerConnection, then wait for 'userJoined'.
                    try {
                        await setupLocalMediaAndPeerConnection();
                    } catch (error) {
                        // Error is handled within setupLocalMediaAndPeerConnection (e.g., UI reset).
                        return; 
                    }
                    // The initiator waits for the 'userJoined' message before creating and sending an offer.
                    break;

                case 'userJoined':
                    // Server indicates another user has joined the session.
                    // This message is received by both the initiator and the new receiver.
                    callStatus.textContent = `User joined session: ${message.sessionId}. Setting up call...`;
                    if (localPeerRole === 'initiator') {
                        // If this client is the initiator, it's time to create and send an SDP offer.
                        await createAndSendOffer();
                    } else { // localPeerRole would be 'receiver'.
                        // If this client is the receiver, it has already set up local media and PeerConnection
                        // (in `handleJoinCall`). Now it waits for the 'offer' message from the initiator.
                        callStatus.textContent = `Joined session ${message.sessionId}. Waiting for offer...`;
                    }
                    break;

                case 'offer':
                    // Received an SDP offer from the remote peer (via the server). This client is the 'receiver'.
                    if (localPeerRole === 'receiver') {
                        // Ensure PeerConnection is initialized. This is a safeguard.
                        if (!peerConnection) {
                            console.warn("PeerConnection not ready for offer, attempting setup.");
                            try {
                                await setupLocalMediaAndPeerConnection(); // Attempt setup if not already done.
                            } catch (error) {
                                callStatus.textContent = "Error setting up for offer. Call may fail.";
                                return;
                            }
                        }
                        callStatus.textContent = 'Offer received. Creating answer...';
                        // Set the received offer as the remote description.
                        await peerConnection.setRemoteDescription(new RTCSessionDescription(message.sdp));
                        // Create and send an SDP answer.
                        await createAndSendAnswer();
                    }
                    break;

                case 'answer':
                    // Received an SDP answer from the remote peer (via the server). This client is the 'initiator'.
                    if (localPeerRole === 'initiator') {
                        callStatus.textContent = 'Answer received. Connection should establish.';
                        // Set the received answer as the remote description.
                        // This completes the SDP exchange for the initiator. ICE candidate exchange continues.
                        await peerConnection.setRemoteDescription(new RTCSessionDescription(message.sdp));
                    }
                    break;

                case 'iceCandidate':
                    // Received an ICE candidate from the remote peer (via the server).
                    try {
                        // Add the ICE candidate if PeerConnection exists and remote description has been set.
                        // ICE candidates might arrive before the SDP exchange is fully complete.
                        if (peerConnection && peerConnection.remoteDescription) {
                            await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
                            console.log('ICE candidate added.');
                        } else {
                            // If PeerConnection isn't ready, the candidate might be lost or could be buffered.
                            // For simplicity, this example logs a warning. Production apps might buffer candidates.
                            console.warn('PeerConnection not ready for ICE candidate or remoteDescription not set. Candidate ignored.');
                        }
                    } catch (error) {
                        console.error('Error adding received ICE candidate:', error);
                    }
                    break;

                case 'userLeft':
                    // Server indicates the other user has left the session.
                    callStatus.textContent = `User left session: ${message.sessionId}. Call ended.`;
                    hangUpCall(true); // End the call, indicating it's a remote hangup.
                    break;

                case 'sessionError':
                    // Received an error message from the server regarding the session.
                    console.error('Session error:', message.message);
                    callStatus.textContent = `Error: ${message.message}`;
                    alert(`Signaling Error: ${message.message}`); // Show an alert to the user.
                    resetUIForNewCall(); // Reset the UI to allow starting a new call.
                    break;

                default:
                    console.warn('Unknown message type from server:', message.type);
            }
        };

        /**
         * WebSocket 'onerror' event handler.
         * Called when an error occurs with the WebSocket connection.
         */
        websocket.onerror = (error) => {
            console.error('WebSocket error:', error);
            callStatus.textContent = 'WebSocket error. Check console.';
            alert('Could not connect to signaling server. Please ensure it is running and the URL is correct.');
            resetUIForNewCall(); // Reset UI on connection error.
            reject(error); // Reject the promise from `connectWebSocket`.
        };

        /**
         * WebSocket 'onclose' event handler.
         * Called when the WebSocket connection is closed.
         */
        websocket.onclose = () => {
            console.log('WebSocket connection closed.');
            // Provide feedback if the call was active or being set up.
            if (createCallButton.disabled === true) { 
                 callStatus.textContent = 'Disconnected from signaling server.';
            }
            // If PeerConnection exists and is not already closed/failed, clean it up.
            if (peerConnection && peerConnection.connectionState !== 'closed' && peerConnection.connectionState !== 'failed') {
                 hangUpCall(true); // Treat as a remote hangup to ensure cleanup.
            }
            // Reset UI for a new call. This is simpler for this app than attempting reconnections.
            resetUIForNewCall();
        };
    });
}

/**
 * Sends a message to the signaling server via WebSocket.
 * The message object is stringified to JSON before sending.
 * @param {object} message - The message object to send.
 */
function sendWebSocketMessage(message) {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify(message)); // Send the message as a JSON string.
        console.log('WebSocket message sent:', message);
    } else {
        console.error('WebSocket is not connected.');
        callStatus.textContent = 'Error: Not connected to signaling server.';
        // Further actions like alerting the user or attempting reconnection could be added here.
    }
}

/**
 * Sets up local media (camera and microphone access) and initializes the RTCPeerConnection.
 * This function is called when starting or joining a call.
 * It handles requesting `getUserMedia` and then calls `createPeerConnection`.
 * Throws an error if media access fails, which is caught by the calling function.
 */
async function setupLocalMediaAndPeerConnection() {
    // If a peer connection is already active, no need to re-setup.
    if (peerConnection && (peerConnection.connectionState === 'connected' || peerConnection.connectionState === 'connecting')) {
        console.log("Peer connection already active.");
        return;
    }
    // If localStream already exists (e.g., from a previous failed attempt where media was obtained),
    // reuse it, but ensure PeerConnection is (re)created.
    if (localStream) {
        console.log("Local stream already exists. Re-creating PeerConnection.");
        createPeerConnection(); // Re-initialize PeerConnection with existing stream.
        hangupButton.disabled = false; // Ensure hangup button is enabled.
        return;
    }
    try {
        // Request access to user's camera and microphone.
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream; // Display the local video stream.
        console.log('Local stream obtained.');

        createPeerConnection(); // Initialize the RTCPeerConnection object.
        hangupButton.disabled = false; // Enable the hangup button as media is now active.

    } catch (error) {
        console.error('Error accessing media devices.', error);
        callStatus.textContent = `Error accessing media: ${error.message}`;
        alert(`Error accessing media devices: ${error.message}`);
        resetUIForNewCall(); // Reset UI if media access fails.
        throw error; // Re-throw the error to be handled by the caller.
    }
}


/**
 * Creates and configures the RTCPeerConnection object.
 * This function is central to WebRTC, setting up how peers connect and communicate.
 * Changes from manual signaling: ICE candidates are now sent via WebSocket.
 */
function createPeerConnection() {
    console.log('Creating PeerConnection...');
    // Close any existing peer connection before creating a new one.
    if (peerConnection) {
        peerConnection.close();
    }
    peerConnection = new RTCPeerConnection(configuration); // Create the RTCPeerConnection with STUN server config.

    // Add local media tracks to the PeerConnection if the local stream is available.
    // These tracks will be transmitted to the remote peer.
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    } else {
        // This might happen if createPeerConnection is called before localStream is ready.
        // Tracks can be added later, but this indicates a potential logic flow issue to review.
        console.warn("Local stream not available when creating peer connection. Tracks will not be added yet.");
    }

    /**
     * RTCPeerConnection 'ontrack' event handler.
     * Triggered when a remote media track is received from the other peer.
     * @param {RTCTrackEvent} event - The event containing the remote media track.
     */
    peerConnection.ontrack = event => {
        console.log('Remote track received:', event.streams[0]);
        // Display the first remote stream received in the `remoteVideo` element.
        if (remoteVideo.srcObject !== event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
        }
    };

    /**
     * RTCPeerConnection 'onicecandidate' event handler.
     * Triggered when the local ICE agent generates a new ICE candidate.
     * These candidates must be sent to the remote peer (via the signaling server).
     * @param {RTCPeerConnectionIceEvent} event - The event containing the ICE candidate.
     */
    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            console.log('New ICE candidate generated:', event.candidate);
            // Send the generated ICE candidate to the remote peer via WebSocket.
            sendWebSocketMessage({
                type: 'iceCandidate',
                sessionId: currentSessionId, // Include current session ID for routing by the server.
                candidate: event.candidate   // The ICE candidate data.
            });
        }
    };

    /**
     * RTCPeerConnection 'onconnectionstatechange' event handler.
     * Monitors the state of the peer-to-peer connection and updates the UI accordingly.
     */
    peerConnection.onconnectionstatechange = () => {
        console.log('PeerConnection state:', peerConnection.connectionState);
        switch (peerConnection.connectionState) {
            case 'connected':
                callStatus.textContent = 'Call connected!';
                // Disable call creation/joining buttons when a call is active.
                createCallButton.disabled = true;
                joinCallButton.disabled = true;
                sessionIdInput.disabled = true;
                break;
            case 'failed':
                callStatus.textContent = 'Call connection failed.';
                hangUpCall(true); // Treat as a remote hangup to ensure cleanup.
                break;
            case 'disconnected':
                // 'disconnected' can sometimes be a temporary state. WebRTC might try to reconnect.
                callStatus.textContent = 'Call disconnected. Attempting to reconnect...';
                // If it doesn't recover and moves to 'failed', that state will handle cleanup.
                break;
            case 'closed':
                callStatus.textContent = 'Call closed.';
                // `hangUpCall` usually handles this. No explicit action needed here if `hangUpCall` was the initiator.
                break;
        }
    };
    console.log('PeerConnection created and configured.');
}

/**
 * Creates an SDP offer and sends it to the remote peer via the signaling server.
 * This function is typically called by the 'initiator' of the call.
 * An offer describes the initiator's media capabilities and proposed session parameters.
 */
async function createAndSendOffer() {
    if (!peerConnection) {
        console.error('PeerConnection not initialized for offer.');
        callStatus.textContent = 'Error: Connection not ready for offer.';
        return;
    }
    try {
        console.log('Creating offer...');
        const offer = await peerConnection.createOffer(); // Create the SDP offer.
        await peerConnection.setLocalDescription(offer); // Set the offer as the local description.
        console.log('Offer created and local description set.');
        // Send the offer to the remote peer via WebSocket.
        sendWebSocketMessage({
            type: 'offer',
            sessionId: currentSessionId,
            sdp: peerConnection.localDescription // The offer SDP.
        });
        callStatus.textContent = 'Offer sent. Waiting for answer...';
    } catch (error) {
        console.error('Error creating offer:', error);
        callStatus.textContent = `Error creating offer: ${error.message}`;
    }
}

/**
 * Creates an SDP answer in response to a received offer and sends it to the remote peer.
 * This function is typically called by the 'receiver' of the call.
 * An answer describes the receiver's media capabilities and acceptance of session parameters.
 */
async function createAndSendAnswer() {
    if (!peerConnection) {
        console.error('PeerConnection not initialized for answer.');
        callStatus.textContent = 'Error: Connection not ready for answer.';
        return;
    }
    try {
        console.log('Creating answer...');
        const answer = await peerConnection.createAnswer(); // Create the SDP answer.
        await peerConnection.setLocalDescription(answer); // Set the answer as the local description.
        console.log('Answer created and local description set.');
        // Send the answer to the remote peer via WebSocket.
        sendWebSocketMessage({
            type: 'answer',
            sessionId: currentSessionId,
            sdp: peerConnection.localDescription // The answer SDP.
        });
        callStatus.textContent = 'Answer sent.';
    } catch (error) {
        console.error('Error creating answer:', error);
        callStatus.textContent = `Error creating answer: ${error.message}`;
    }
}

/**
 * Handles the "Create Call" button click.
 * Initiates a new call session by connecting to the WebSocket server
 * and sending a 'createSession' message.
 */
async function handleCreateCall() {
    console.log('Create Call button clicked.');
    // Disable buttons to prevent multiple actions.
    createCallButton.disabled = true;
    joinCallButton.disabled = true;
    sessionIdInput.disabled = true;
    callStatus.textContent = 'Creating call...';

    try {
        await connectWebSocket(); // Ensure WebSocket connection is established.
        // If connectWebSocket resolves, the connection is open.
        sendWebSocketMessage({ type: 'createSession' }); // Request the server to create a new session.
        // Further actions (like setting up media) happen upon receiving 'sessionCreated' from the server.
    } catch (error) {
        // WebSocket connection errors are handled by `connectWebSocket`'s `onerror` handler,
        // which typically calls `resetUIForNewCall`.
        console.error("WebSocket connection failed for Create Call:", error);
    }
}

/**
 * Handles the "Join Call" button click.
 * Attempts to join an existing call session using a session ID provided by the user.
 * Connects to WebSocket, sets up local media, then sends a 'joinSession' message.
 */
async function handleJoinCall() {
    console.log('Join Call button clicked.');
    const sid = sessionIdInput.value.trim(); // Get the session ID from the input field.
    if (!sid) {
        alert('Please enter a Call ID to join.');
        return;
    }
    
    // Disable buttons during the join process.
    createCallButton.disabled = true;
    joinCallButton.disabled = true;
    sessionIdInput.disabled = true;
    callStatus.textContent = `Joining call ${sid}...`;

    currentSessionId = sid; // Set the current session ID.
    localPeerRole = 'receiver'; // This client will be the 'receiver'.

    try {
        await connectWebSocket(); // Ensure WebSocket connection.
        // Set up local media and PeerConnection *before* sending 'joinSession'.
        // This ensures the receiver is ready to process an offer immediately after joining.
        await setupLocalMediaAndPeerConnection(); 
        sendWebSocketMessage({ type: 'joinSession', sessionId: currentSessionId });
        // Status updates will follow based on server messages ('userJoined', 'offer', etc.).
    } catch (error) {
        // Errors from `connectWebSocket` or `setupLocalMediaAndPeerConnection` are handled within those functions
        // (typically by calling `resetUIForNewCall`).
        console.error('Failed to connect or setup media before joining:', error);
        // If WebSocket didn't connect, its `onerror` or `onclose` would reset the UI.
        // If `setupLocalMediaAndPeerConnection` failed, it already called `resetUIForNewCall`.
        // Ensure UI is reset if a non-WS error occurred before WS connection was attempted or setup failed.
        if (!(websocket && websocket.readyState === WebSocket.OPEN)) {
             resetUIForNewCall(); 
        }
    }
}

/**
 * Resets UI elements to their initial state, allowing the user to start or join a new call.
 * Called after a call ends, on error, or when the WebSocket connection closes unexpectedly.
 */
function resetUIForNewCall() {
    // Re-enable create/join buttons and session ID input.
    createCallButton.disabled = false;
    joinCallButton.disabled = false;
    sessionIdInput.disabled = false;
    sessionIdInput.value = ''; // Clear session ID input.
    hangupButton.disabled = true; // Disable hangup button.
    callIdDisplay.textContent = ''; // Clear displayed call ID.

    // Reset status message, unless it's showing a persistent error or disconnection message.
    if (callStatus.textContent.startsWith('Error:') || callStatus.textContent.startsWith('Disconnected')) {
        // Keep the existing error/disconnection message.
    } else {
       callStatus.textContent = 'Ready to create or join a call.';
    }
    
    // Clear session-specific global variables.
    localPeerRole = null;
    currentSessionId = null;
    // `localStream` and `peerConnection` are cleaned up in `hangUpCall`, which should be called
    // before or as part of the process leading to `resetUIForNewCall` if a call was active.
}


/**
 * Handles hanging up the call.
 * Closes the RTCPeerConnection, stops local media tracks, clears video elements,
 * and resets the UI for a new call.
 * Changes from manual signaling: Now integrated with WebSocket state, but doesn't
 * explicitly send a 'hangup' message as server handles this via 'close' event.
 * @param {boolean} [isRemoteHangup=false] - True if the hangup was initiated by the remote peer or due to an error,
 *                                           false if initiated by the local user clicking the hangup button.
 */
function hangUpCall(isRemoteHangup = false) {
    console.log(`Hang up call. Remote: ${isRemoteHangup}`);
    
    // Close the PeerConnection if it exists.
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null; // Release the PeerConnection object.
        console.log('PeerConnection closed.');
    }
    // Stop local media tracks and clear the local video element.
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop()); // Stop each track (camera, microphone).
        localStream = null;
        localVideo.srcObject = null; // Clear the video display.
        console.log('Local stream stopped.');
    }
    // Clear the remote video element.
    if (remoteVideo.srcObject) {
        remoteVideo.srcObject = null;
    }

    // Update call status message based on whether the hangup was local or remote/error-induced.
    if (!isRemoteHangup) {
        callStatus.textContent = 'Call ended.';
    } else if (callStatus.textContent && !callStatus.textContent.includes('User left') && !callStatus.textContent.includes('failed') && !callStatus.textContent.includes('Disconnected')) {
        // Avoid overwriting more specific messages like "User left", "Call connection failed", or "Disconnected".
        callStatus.textContent = 'Call ended remotely or due to error.';
    }

    resetUIForNewCall(); // Reset UI elements to their initial state.

    // The WebSocket connection is intentionally not closed here.
    // It can be reused for subsequent calls. If the WebSocket connection itself
    // is the source of the problem, its `onclose` or `onerror` handlers will manage UI resets.
    // Closing it here would trigger its `onclose` handler, potentially leading to redundant UI updates.
    // Example: if (websocket && websocket.readyState === WebSocket.OPEN) { websocket.close(); }

    console.log('Call cleanup complete.');
}

// Initialize the application when the script loads.
// This sets up event listeners and initial UI states.
initialize();

// Global error handlers for unhandled errors and promise rejections.
// These can help catch issues that might otherwise go unnoticed.
window.addEventListener('error', function(event) {
    console.error('Unhandled error:', event.error || event.message);
    // Optionally, display a generic error message to the user in the UI.
});
window.addEventListener('unhandledrejection', function(event) {
    console.error('Unhandled promise rejection:', event.reason);
});
