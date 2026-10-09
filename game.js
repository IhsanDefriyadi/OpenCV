/**
 * GESTURE 21 ELIMINATION CHALLENGE
 * Real-time camera & gesture-based 2-player turn game.
 */

// --- Game State ---
const TARGET_SCORE = 21;
let currentScore = 0;
let currentPlayer = 1; // 1 or 2
let isGameOver = false;
let isCooldown = false; // Cooldown after a move is submitted
const TURN_TIMEOUT_SECONDS = 5;
let turnTimer = null;
let remainingSeconds = TURN_TIMEOUT_SECONDS;
let consecutiveTimeouts = 0;
let isPaused = false;


// Gesture Hold-to-Confirm State
let detectedFingers = 0;
let lastHeldFingers = 0;
let holdStartTime = 0;
const HOLD_DURATION_MS = 1000; // Tahan gestur 1 detik untuk mengunci angka
const COOLDOWN_DURATION_MS = 1800; // Waktu jeda agar giliran berpindah dengan mulus

// --- DOM Elements ---
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output-canvas');
const canvasCtx = canvasElement.getContext('2d');

const currentScoreEl = document.getElementById('current-score');
const dangerBarEl = document.getElementById('danger-bar');
const cardP1 = document.getElementById('card-p1');
const cardP2 = document.getElementById('card-p2');
const indicatorP1 = document.getElementById('indicator-p1');
const indicatorP2 = document.getElementById('indicator-p2');

const timerP1 = document.getElementById('timer-p1');
const timerP2 = document.getElementById('timer-p2');
const pauseModal = document.getElementById('pause-modal');
const btnResumeGame = document.getElementById('btn-resume-game');

const camStatusEl = document.getElementById('cam-status');
const detectedCountEl = document.getElementById('detected-count');
const confirmTextBox = document.getElementById('confirm-text');
const confirmBarEl = document.getElementById('confirm-bar');
const camPromptEl = document.getElementById('cam-prompt');
const btnStartCam = document.getElementById('btn-start-camera');

const turnLogsEl = document.getElementById('turn-logs');
const btnResetGame = document.getElementById('btn-reset-game');

const gameOverModal = document.getElementById('game-over-modal');
const loserNameEl = document.getElementById('loser-name');
const winnerNameEl = document.getElementById('winner-name');
const finalScoreEl = document.getElementById('final-score');
const btnModalRestart = document.getElementById('btn-modal-restart');

// --- Simple Web Audio Synthesizer (Zero External Audio Files Needed) ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playTone(freq, type = 'sine', duration = 0.1, gainVal = 0.15) {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(gainVal, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

function playTurnSound() {
    playTone(523.25, 'triangle', 0.15, 0.2); // C5
    setTimeout(() => playTone(659.25, 'triangle', 0.2, 0.2), 100); // E5
}

function playGameOverSound() {
    playTone(300, 'sawtooth', 0.3, 0.25);
    setTimeout(() => playTone(220, 'sawtooth', 0.4, 0.3), 200);
    setTimeout(() => playTone(140, 'sawtooth', 0.6, 0.4), 400);
}

// --- Game Logic Functions ---

function updateTurnUI() {
    if (currentPlayer === 1) {
        cardP1.classList.add('active-turn');
        cardP2.classList.remove('active-turn');
        indicatorP1.textContent = 'GILIRAN ANDA';
        indicatorP2.textContent = 'MENUNGGU';
    } else {
        cardP2.classList.add('active-turn');
        cardP1.classList.remove('active-turn');
        indicatorP2.textContent = 'GILIRAN ANDA';
        indicatorP1.textContent = 'MENUNGGU';
    }

    // Danger Bar Calculation
    const percentage = Math.min(100, (currentScore / TARGET_SCORE) * 100);
    dangerBarEl.style.width = `${percentage}%`;
}

function logMessage(text, className = '') {
    const item = document.createElement('div');
    item.className = `log-item ${className}`;
    item.textContent = text;
    turnLogsEl.appendChild(item);
    turnLogsEl.scrollTop = turnLogsEl.scrollHeight;
}

function applyTurn(addedNumber) {
    if (isGameOver || isCooldown) return;

    const previousScore = currentScore;
    currentScore += addedNumber;

    // Trigger visual score bump
    currentScoreEl.textContent = currentScore;
    currentScoreEl.classList.add('bump');
    setTimeout(() => currentScoreEl.classList.remove('bump'), 300);

    const logClass = currentPlayer === 1 ? 'p1-action' : 'p2-action';
    logMessage(`Player ${currentPlayer} memilih +${addedNumber} (Skor: ${previousScore} ➔ ${currentScore})`, logClass);

    // Evaluasi Kondisi Kalah / Game Over (Aturan: >= 21 KALAH)
    if (currentScore >= TARGET_SCORE) {
        handleGameOver();
    } else {
        // Giliran aman, switch player
        playTurnSound();
        consecutiveTimeouts = 0; // Reset karena pemain aktif merespon
        currentPlayer = (currentPlayer === 1) ? 2 : 1;
        updateTurnUI();
        startCooldown();
    }
}
function stopTurnTimer() {
    if (turnTimer) {
        clearInterval(turnTimer);
        turnTimer = null;
    }
}

function updateTimerDisplay() {
    if (timerP1) timerP1.textContent = currentPlayer === 1 ? `(${remainingSeconds}s)` : '';
    if (timerP2) timerP2.textContent = currentPlayer === 2 ? `(${remainingSeconds}s)` : '';
}

function startTurnTimer() {
    stopTurnTimer();
    if (isGameOver || isPaused) return;

    remainingSeconds = TURN_TIMEOUT_SECONDS;
    updateTimerDisplay();

    turnTimer = setInterval(() => {
        if (isGameOver || isPaused || isCooldown) return;

        remainingSeconds--;
        updateTimerDisplay();

        if (remainingSeconds <= 0) {
            stopTurnTimer();
            handleTurnTimeout();
        }
    }, 1000);
}

function handleTurnTimeout() {
    consecutiveTimeouts++;

    if (consecutiveTimeouts >= 2) {
        pauseGame();
    } else {
        logMessage(`⏱️ Player ${currentPlayer} tidak merespon 5 detik! Giliran dioper.`);
        currentPlayer = (currentPlayer === 1) ? 2 : 1;
        updateTurnUI();
        startCooldown();
    }
}
function pauseGame() {
    isPaused = true;
    stopTurnTimer();
    if (pauseModal) pauseModal.style.display = 'flex';
    logMessage(`⏸ Game dijeda: kedua pemain tidak merespon.`, 'game-over-log');
}

function resumeGame() {
    isPaused = false;
    consecutiveTimeouts = 0;
    if (pauseModal) pauseModal.style.display = 'none';
    logMessage(`▶Permainan dilanjutkan! Giliran Player ${currentPlayer}.`);
    updateTurnUI();
    startTurnTimer();
}


function startCooldown() {
    isCooldown = true;
    confirmTextBox.textContent = `Giliran berganti ke Player ${currentPlayer}! Bersiap...`;
    confirmBarEl.style.width = '0%';
    confirmBarEl.style.background = '#64748b';
    startTurnTimer();


    setTimeout(() => {
        isCooldown = false;
        confirmTextBox.textContent = `Tahan gestur 1, 2, atau 3 jari untuk konfirmasi...`;
        confirmBarEl.style.background = 'linear-gradient(90deg, #00f2fe, #ffb703)';
        startTurnTimer
    }, COOLDOWN_DURATION_MS);
}

function handleGameOver() {
    isGameOver = true;
    playGameOverSound();

    const loser = currentPlayer;
    const winner = (currentPlayer === 1) ? 2 : 1;

    logMessage(`🚨 GAME OVER! Player ${loser} mencapai ${currentScore} (>= 21)! Player ${winner} MENANG!`, 'game-over-log');

    // Tampilkan Modal Game Over
    loserNameEl.textContent = `Player ${loser}`;
    finalScoreEl.textContent = currentScore;
    winnerNameEl.textContent = `PLAYER ${winner}`;
    gameOverModal.style.display = 'flex';
}

function resetGame() {
    currentScore = 0;
    currentPlayer = 1;
    isGameOver = false;
    isCooldown = false;
    detectedFingers = 0;
    lastHeldFingers = 0;
    holdStartTime = 0;

    currentScoreEl.textContent = '0';
    dangerBarEl.style.width = '0%';
    confirmBarEl.style.width = '0%';
    confirmTextBox.textContent = 'Tahan gestur 1, 2, atau 3 jari untuk konfirmasi...';
    gameOverModal.style.display = 'none';

    turnLogsEl.innerHTML = '<div class="log-item initial">Game dimulai ulang! Total angka: 0. Giliran Player 1.</div>';
    updateTurnUI();
    startTurnTimer();
}

// --- Computer Vision: Finger Landmark Counting Algorithm ---

/**
 * Menghitung jumlah jari yang terangkat dari koordinat 21 landmarks MediaPipe
 */
function countExtendedFingers(landmarks) {
    if (!landmarks || landmarks.length < 21) return 0;

    let extendedCount = 0;

    // 1. Jempol (Thumb): periksa jarak ujung jempol (4) terhadap pangkal kelingking (17) vs sendi jempol (3)
    const thumbTip = landmarks[4];
    const thumbIp = landmarks[3];
    const pinkyBase = landmarks[17];
    const distTipToPinky = Math.hypot(thumbTip.x - pinkyBase.x, thumbTip.y - pinkyBase.y);
    const distIpToPinky = Math.hypot(thumbIp.x - pinkyBase.x, thumbIp.y - pinkyBase.y);
    if (distTipToPinky > distIpToPinky * 1.2) {
        extendedCount++;
    }

    // 2. Telunjuk (Index): Ujung (8) lebih tinggi di layar daripada sendi PIP (6)
    if (landmarks[8].y < landmarks[6].y) extendedCount++;

    // 3. Jari Tengah (Middle): Ujung (12) lebih tinggi daripada sendi PIP (10)
    if (landmarks[12].y < landmarks[10].y) extendedCount++;

    // 4. Jari Manis (Ring): Ujung (16) lebih tinggi daripada sendi PIP (14)
    if (landmarks[16].y < landmarks[14].y) extendedCount++;

    // 5. Kelingking (Pinky): Ujung (20) lebih tinggi daripada sendi PIP (18)
    if (landmarks[20].y < landmarks[18].y) extendedCount++;

    return extendedCount;
}

/**
 * Gambar garis skeleton tangan dan titik landmark pada canvas
 */
function drawHandLandmarks(landmarks) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    // Koneksi antar sendi tangan MediaPipe
    const connections = [
        [0, 1], [1, 2], [2, 3], [3, 4],       // Jempol
        [0, 5], [5, 6], [6, 7], [7, 8],       // Telunjuk
        [5, 9], [9, 10], [10, 11], [11, 12],  // Tengah
        [9, 13], [13, 14], [14, 15], [15, 16],// Manis
        [13, 17], [17, 18], [18, 19], [19, 20],// Kelingking
        [0, 17]                               // Telapak bawah
    ];

    const strokeColor = currentPlayer === 1 ? '#00f2fe' : '#ff0844';

    // Gambar garis penghubung
    canvasCtx.strokeStyle = strokeColor;
    canvasCtx.lineWidth = 3;
    canvasCtx.lineCap = 'round';

    connections.forEach(([i, j]) => {
        const p1 = landmarks[i];
        const p2 = landmarks[j];
        canvasCtx.beginPath();
        canvasCtx.moveTo(p1.x * canvasElement.width, p1.y * canvasElement.height);
        canvasCtx.lineTo(p2.x * canvasElement.width, p2.y * canvasElement.height);
        canvasCtx.stroke();
    });

    // Gambar titik-titik sendi
    landmarks.forEach((p, index) => {
        canvasCtx.beginPath();
        canvasCtx.arc(p.x * canvasElement.width, p.y * canvasElement.height, [4, 8, 12, 16, 20].includes(index) ? 6 : 4, 0, 2 * Math.PI);
        canvasCtx.fillStyle = [4, 8, 12, 16, 20].includes(index) ? '#ffb703' : '#ffffff';
        canvasCtx.fill();
    });

    canvasCtx.restore();
}

/**
 * Callback saat MediaPipe mendeteksi frame tangan
 */
function onResults(results) {
    canvasElement.width = videoElement.videoWidth || 640;
    canvasElement.height = videoElement.videoHeight || 480;

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        drawHandLandmarks(landmarks);

        const count = countExtendedFingers(landmarks);
        detectedFingers = count;
        detectedCountEl.textContent = count;

        handleGestureProgress(count);
    } else {
        // Tangan tidak terlihat di kamera
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        detectedCountEl.textContent = '-';
        resetHoldProgress();
    }
}

/**
 * Mengelola progres hold (tahan gestur) sebelum dieksekusi
 */
function handleGestureProgress(fingers) {
    if (isGameOver || isCooldown) return;

    // Game hanya menerima angka 1, 2, atau 3
    if (fingers >= 1 && fingers <= 3) {
        const now = Date.now();

        if (fingers === lastHeldFingers) {
            const elapsed = now - holdStartTime;
            const progress = Math.min(100, (elapsed / HOLD_DURATION_MS) * 100);
            confirmBarEl.style.width = `${progress}%`;
            confirmTextBox.innerHTML = `Mengunci <strong>+${fingers}</strong> untuk Player ${currentPlayer}...`;

            // Jika sudah ditahan cukup lama
            if (elapsed >= HOLD_DURATION_MS) {
                applyTurn(fingers);
                resetHoldProgress();
            }
        } else {
            // Gestur berganti, restart timer tahan
            lastHeldFingers = fingers;
            holdStartTime = now;
            confirmBarEl.style.width = '0%';
        }
    } else {
        // Gestur di luar 1, 2, 3 (misal kepalan 0 atau 4/5 jari)
        confirmTextBox.textContent = 'Tunjukkan 1, 2, atau 3 jari saja!';
        resetHoldProgress();
    }
}

function resetHoldProgress() {
    lastHeldFingers = 0;
    holdStartTime = 0;
    confirmBarEl.style.width = '0%';
}

// --- Inisialisasi MediaPipe Hands & Kamera ---

function initMediaPipe() {
    camStatusEl.innerHTML = '<span class="status-dot"></span> Menghubungkan Kamera...';

    const hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6
    });

    hands.onResults(onResults);

    const camera = new Camera(videoElement, {
        onFrame: async () => {
            if (videoElement.readyState >= 2) {
                await hands.send({ image: videoElement });
            }
        },
        width: 640,
        height: 480
    });

    camera.start()
        .then(() => {
            camStatusEl.innerHTML = '<span class="status-dot" style="background:#10b981;box-shadow:0 0 8px #10b981"></span> Kamera Aktif';
            camPromptEl.style.display = 'none';
        })
        .catch((err) => {
            console.error('Gagal mengakses kamera:', err);
            camStatusEl.innerHTML = '<span class="status-dot" style="background:#ef4444;box-shadow:0 0 8px #ef4444"></span> Izin Kamera Ditolak';
            camPromptEl.style.display = 'flex';
        });
}

// --- Event Listeners ---

// Tombol manual (+1, +2, +3) untuk opsi sentuh / fallback
document.querySelectorAll('.btn-add').forEach(button => {
    button.addEventListener('click', (e) => {
        const val = parseInt(e.target.getAttribute('data-val'), 10);
        applyTurn(val);
    });
});

if (btnResumeGame) btnResumeGame.addEventListener('click', resumeGame);
btnResetGame.addEventListener('click', resetGame);
btnModalRestart.addEventListener('click', resetGame);

btnStartCam.addEventListener('click', () => {
    initMediaPipe();
});

// Inisialisasi awal saat halaman dimuat
window.addEventListener('DOMContentLoaded', () => {
    updateTurnUI();
    initMediaPipe();
    startTurnTimer();
});
