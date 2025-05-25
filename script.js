// Get HTML elements
// Video elements for displaying local and remote video streams
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
// Buttons for starting and ending the call
const startButton = document.getElementById('startButton');
const hangupButton = document.getElementById('hangupButton');

// Signaling UI elements: Textareas and buttons for manual exchange of SDP and ICE candidates
// For SDP Offer
const sdpOfferInput = document.getElementById('sdpOfferInput'); // Callee pastes offer here
const createOfferButton = document.getElementById('createOfferButton'); // Caller clicks to create offer
const sdpOfferOutput = document.getElementById('sdpOfferOutput'); // Caller copies offer from here

// For SDP Answer
const sdpAnswerInput = document.getElementById('sdpAnswerInput'); // Caller pastes answer here
const createAnswerButton = document.getElementById('createAnswerButton'); // Callee clicks to create answer
const sdpAnswerOutput = document.getElementById('sdpAnswerOutput'); // Callee copies answer from here

const receiveAnswerButton = document.getElementById('receiveAnswerButton'); // Caller clicks after pasting answer

// For ICE Candidates
const iceCandidateInput = document.getElementById('iceCandidateInput'); // For pasting received ICE candidates
const addIceCandidateButton = document.getElementById('addIceCandidateButton'); // Click to add pasted ICE candidate
const iceCandidateOutput = document.getElementById('iceCandidateOutput'); // Locally generated ICE candidates appear here


// Global variables
let localStream; // Holds the local audio/video stream
let remoteStream; // Placeholder for the remote audio/video stream (though often handled directly by ontrack)
let peerConnection; // The RTCPeerConnection object

/**
 * Configuration for the RTCPeerConnection.
 * Includes STUN server URLs for NAT traversal. STUN servers help discover the public IP and port.
 * For this simple example, only Google's public STUN server is listed.
 * In a production environment, you might include TURN servers for more complex network scenarios (e.g., symmetric NATs).
 */
const configuration = {
    iceServers: [
        {
            urls: 'stun:stun.l.google.com:19302' // Google's public STUN server
        }
    ]
};

/**
 * Initializes the application.
 * Sets up event listeners for the main control buttons (Start, Hang Up)
 * and the manual signaling buttons.
 * Disables Hang Up and signaling buttons initially, as they are not relevant before a call starts.
 */
async function initialize() {
    console.log('Initializing application...');
    // Attach event listeners to call control buttons
    startButton.addEventListener('click', startCall);
    hangupButton.addEventListener('click', hangUpCall);

    // Attach event listeners to signaling UI buttons
    createOfferButton.addEventListener('click', createOfferAndDisplay);
    createAnswerButton.addEventListener('click', createAnswerAndDisplay);
    receiveAnswerButton.addEventListener('click', receiveAnswerFromInput);
    addIceCandidateButton.addEventListener('click', addIceCandidateFromInput);

    // Set initial state for buttons
    hangupButton.disabled = true;
    disableSignalingButtons(true); // Disable all signaling buttons at start
}

/**
 * Helper function to enable or disable all signaling-related UI elements.
 * @param {boolean} disabled - True to disable the buttons, false to enable.
 */
function disableSignalingButtons(disabled) {
    createOfferButton.disabled = disabled;
    createAnswerButton.disabled = disabled;
    sdpOfferInput.disabled = disabled;
    sdpAnswerInput.disabled = disabled;
    receiveAnswerButton.disabled = disabled;
    iceCandidateInput.disabled = disabled;
    addIceCandidateButton.disabled = disabled;
}

/**
 * Handles the "Start Call" button click.
 * 1. Disables the start button and enables the hangup button.
 * 2. Enables signaling UI buttons.
 * 3. Requests access to the user's camera and microphone (getUserMedia).
 * 4. Displays the local video stream.
 * 5. Creates and initializes the RTCPeerConnection.
 * Includes error handling for media access.
 */
async function startCall() {
    console.log('Start call button clicked.');
    startButton.disabled = true;
    hangupButton.disabled = false;
    disableSignalingButtons(false); // Enable signaling buttons as a call is now active

    try {
        // Request access to local media (audio and video)
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        console.log('Local stream obtained');
        localVideo.srcObject = localStream; // Display local video stream in the 'localVideo' element

        // Create the RTCPeerConnection after local media is successfully obtained
        createPeerConnection();

    } catch (error) {
        console.error('Error accessing media devices.', error);
        alert('Error accessing media devices: ' + error.message);
        // Reset UI to initial state in case of error
        startButton.disabled = false;
        hangupButton.disabled = true;
        disableSignalingButtons(true);
    }
}

/**
 * Creates and configures the RTCPeerConnection object.
 * This is where the core WebRTC setup happens.
 * - Sets up event handlers for 'ontrack', 'onicecandidate', and 'onconnectionstatechange'.
 * - Adds local media tracks to the connection to be sent to the remote peer.
 */
function createPeerConnection() {
    console.log('Creating PeerConnection...');
    peerConnection = new RTCPeerConnection(configuration); // Create the connection with STUN server config
    console.log('PeerConnection created.');

    // Add local media tracks to the RTCPeerConnection.
    // These tracks will be transmitted to the remote peer.
    localStream.getTracks().forEach(track => {
        console.log('Adding local track:', track);
        peerConnection.addTrack(track, localStream);
    });

    /**
     * Event handler for when a remote track is received from the peer.
     * This is triggered when the remote peer adds tracks to the connection.
     * @param {RTCTrackEvent} event - The event object containing the remote track.
     */
    peerConnection.ontrack = event => {
        console.log('Remote track received:', event.streams[0]);
        // When a remote track is received, display it in the 'remoteVideo' element.
        // Check if the remoteVideo element already has a srcObject to avoid unnecessary reassignments.
        if (!remoteVideo.srcObject || remoteVideo.srcObject !== event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
            console.log('Assigned remote stream to remote video element');
        }
    };

    /**
     * Event handler for when an ICE candidate is generated by the local ICE agent.
     * These candidates need to be sent to the remote peer (via manual signaling in this app).
     * @param {RTCPeerConnectionIceEvent} event - The event object containing the ICE candidate.
     */
    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            console.log('New ICE candidate generated:', event.candidate);
            // Display the ICE candidate in the 'iceCandidateOutput' textarea for manual copying.
            // Each candidate is a JSON object; stringify it and add a newline for readability.
            iceCandidateOutput.value += JSON.stringify(event.candidate) + '\n';
        }
    };
    
    /**
     * Event handler for changes in the connection state.
     * Useful for logging and debugging connection status.
     * @param {Event} event - The event object.
     */
    peerConnection.onconnectionstatechange = event => {
        console.log('PeerConnection state changed:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') {
            console.log('Peers connected!');
            // Could add UI indication of successful connection here.
        }
        if (peerConnection.connectionState === 'failed') {
            console.error('Peer connection failed.');
            // Could attempt to restart ICE or provide user feedback.
        }
    };
}

/**
 * Creates an SDP offer, sets it as the local description for the peer connection,
 * and displays the offer in the `sdpOfferOutput` textarea.
 * This is typically called by the peer initiating the call (the "caller").
 */
async function createOfferAndDisplay() {
    if (!peerConnection) {
        alert('Please start the call first (click Start Call).');
        return;
    }
    try {
        console.log('Creating offer...');
        // Create an SDP offer. This describes the local peer's media capabilities.
        const offer = await peerConnection.createOffer();
        console.log('Offer created.');
        // Set the created offer as the local description. This starts the ICE gathering process.
        await peerConnection.setLocalDescription(offer);
        console.log('Local description set with offer.');
        // Display the offer (which is now the peerConnection.localDescription) in the textarea.
        // The user will copy this and send it to the other peer.
        sdpOfferOutput.value = JSON.stringify(peerConnection.localDescription);
    } catch (error) {
        console.error('Error creating offer:', error);
        alert('Error creating offer: ' + error.message);
    }
}

/**
 * Creates an SDP answer based on a received offer.
 * 1. Parses the offer SDP from `sdpOfferInput`.
 * 2. Sets the received offer as the remote description.
 * 3. Creates an SDP answer.
 * 4. Sets the answer as the local description.
 * 5. Displays the answer in `sdpAnswerOutput` for the user to send back to the caller.
 * This is typically called by the peer receiving the call (the "callee").
 */
async function createAnswerAndDisplay() {
    if (!peerConnection) {
        // This check is important. The callee also needs to click "Start Call"
        // to initialize their local media and peerConnection object before creating an answer.
        alert('Please start the call first (click Start Call).');
        return;
    }
    const offerSdpString = sdpOfferInput.value;
    if (!offerSdpString) {
        alert('Please paste the Offer SDP from the other peer first.');
        return;
    }

    try {
        // Parse the offer string (should be a JSON representation of RTCSessionDescriptionInit)
        const offerSdp = JSON.parse(offerSdpString);
        console.log('Received offer SDP for creating answer:', offerSdp);

        // Set the received offer as the remote description on our peer connection.
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offerSdp));
        console.log('Remote description set with pasted offer.');

        console.log('Creating answer...');
        // Create an SDP answer based on the remote description (the offer).
        const answer = await peerConnection.createAnswer();
        console.log('Answer created.');
        // Set the created answer as our local description.
        await peerConnection.setLocalDescription(answer);
        console.log('Local description set with answer.');
        // Display the answer (now peerConnection.localDescription) in the textarea.
        // The user will copy this and send it back to the offering peer.
        sdpAnswerOutput.value = JSON.stringify(peerConnection.localDescription);
        sdpOfferInput.value = ''; // Clear the input field now that it's processed.
    } catch (error) {
        console.error('Error creating answer:', error);
        alert('Error creating answer: ' + error.message);
    }
}

/**
 * Receives an SDP answer from the `sdpAnswerInput` textarea and sets it as the remote description.
 * This is typically called by the peer that initiated the call (the "caller") after
 * receiving the answer from the "callee".
 */
async function receiveAnswerFromInput() {
    if (!peerConnection || !peerConnection.localDescription) {
        // Caller must have created an offer and set local description first.
        alert('Connection not initialized or offer not created. Please create an offer first.');
        return;
    }
    const answerSdpString = sdpAnswerInput.value;
    if (!answerSdpString) {
        alert('Please paste the Answer SDP from the other peer.');
        return;
    }

    try {
        // Parse the answer string (should be a JSON representation of RTCSessionDescriptionInit)
        const answerSdp = JSON.parse(answerSdpString);
        console.log('Received answer SDP for setting remote description:', answerSdp);

        // Set the received answer as the remote description on our peer connection.
        // This completes the SDP exchange for the caller.
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answerSdp));
        console.log('Remote description set with pasted answer.');
        sdpAnswerInput.value = ''; // Clear the input field.
    } catch (error) {
        console.error('Error setting remote description from answer:', error);
        alert('Error processing answer: ' + error.message);
    }
}

/**
 * Takes an ICE candidate string from the `iceCandidateInput` textarea,
 * parses it, and adds it to the RTCPeerConnection.
 * Both peers will do this whenever they receive an ICE candidate from the other peer.
 */
async function addIceCandidateFromInput() {
    if (!peerConnection || !peerConnection.remoteDescription) {
        // ICE candidates are typically exchanged after SDP offer/answer is complete
        // and remoteDescription is set.
        alert('Connection not initialized or SDP exchange not complete. Please exchange Offer/Answer first.');
        return;
    }
    const candidateString = iceCandidateInput.value;
    if (!candidateString) {
        alert('Please paste the ICE candidate from the other peer.');
        return;
    }

    try {
        // Parse the ICE candidate string (should be a JSON representation of RTCIceCandidateInit or RTCIceCandidate)
        const candidate = JSON.parse(candidateString);
        console.log('Adding received ICE candidate:', candidate);
        // Add the received ICE candidate to the local peer connection.
        // The browser's ICE agent uses this information to attempt to establish a connection.
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('ICE candidate added.');
        iceCandidateInput.value = ''; // Clear the input field.
    } catch (error) {
        console.error('Error adding received ICE candidate:', error);
        alert('Error adding ICE candidate: ' + error.message);
    }
}

/**
 * Handles the "Hang Up" button click.
 * 1. Closes the RTCPeerConnection.
 * 2. Stops all local media tracks and releases camera/microphone.
 * 3. Clears the video elements.
 * 4. Resets button states and clears signaling text areas.
 */
function hangUpCall() {
    console.log('Hang up button clicked.');

    // Close the peer connection if it exists
    if (peerConnection) {
        peerConnection.close(); // This will trigger 'connectionstatechange' to 'closed'
        peerConnection = null; // Release the object
        console.log('PeerConnection closed.');
    }

    // Stop local media tracks and clear local video element
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop()); // Stop each track (camera, microphone)
        localStream = null;
        localVideo.srcObject = null; // Clear the video display
        console.log('Local stream stopped and video element cleared.');
    }

    // Clear remote video element
    // Remote stream tracks are managed by the browser when the connection is closed,
    // but we should clear the video element.
    if (remoteVideo.srcObject) {
        remoteVideo.srcObject = null;
        console.log('Remote video element cleared.');
    }
    
    // Reset UI states
    startButton.disabled = false; // Enable Start button
    hangupButton.disabled = true; // Disable Hang Up button
    disableSignalingButtons(true); // Disable all signaling buttons

    // Clear all signaling text areas
    sdpOfferOutput.value = '';
    sdpAnswerOutput.value = '';
    sdpOfferInput.value = '';
    sdpAnswerInput.value = '';
    iceCandidateOutput.value = '';
    iceCandidateInput.value = '';

    console.log('Call ended and resources cleaned up.');
}

// Initialize the application when the script loads.
// This ensures all event listeners and initial states are set up.
initialize();
