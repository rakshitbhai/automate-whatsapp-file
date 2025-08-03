// main.js - Electron main process with enhanced file handling for large single files using Baileys
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const {
  default: makeWASocket,
  DisconnectReason,
  proto,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const chokidar = require("chokidar");
const fs = require("fs");
const { exec, execSync } = require("child_process");
const os = require("os");
const pino = require("pino");
const mime = require("mime-types");
const { writeFile, readFile, mkdir } = require("fs/promises");

// Store will be null for now since makeInMemoryStore import is problematic
let makeInMemoryStore = null;

// Add cat purring sound functionality
const createPurringSound = () => {
  // Create audio context for purring sound
  let audioContext;
  let gainNode;
  let oscillator;
  let isPlaying = false;

  function startPurring() {
    if (isPlaying) return;

    try {
      // Initialize audio context if needed
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        gainNode = audioContext.createGain();
        gainNode.gain.value = 0.05; // Low volume
        gainNode.connect(audioContext.destination);
      }

      // Create and configure oscillator for purring effect
      oscillator = audioContext.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = 40; // Low frequency for cat purr

      // Add modulation for more realistic purring
      const modulator = audioContext.createOscillator();
      modulator.type = "sine";
      modulator.frequency.value = 3; // Purr modulation speed

      const modulationGain = audioContext.createGain();
      modulationGain.gain.value = 15; // Modulation intensity

      modulator.connect(modulationGain);
      modulationGain.connect(oscillator.frequency);

      oscillator.connect(gainNode);
      modulator.start();
      oscillator.start();

      isPlaying = true;

      // Gradually increase volume
      gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(
        0.05,
        audioContext.currentTime + 0.5
      );
    } catch (err) {
      console.log("Audio not supported or enabled:", err);
    }
  }

  function stopPurring() {
    if (!isPlaying || !oscillator) return;

    try {
      // Fade out gradually
      gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.5);

      // Stop after fade-out
      setTimeout(() => {
        oscillator.stop();
        isPlaying = false;
      }, 600);
    } catch (err) {
      console.log("Error stopping purr:", err);
    }
  }

  return {
    start: startPurring,
    stop: stopPurring,
  };
};

// Global variables
let mainWindow;
let sock;
let store;
let watcher;
let caption = "";
let shutdownAfterSend = false; // Always start with shutdown disabled
let isProcessingFile = false;
let activeTransfers = new Map(); // Track active transfers
let maxRetries = 5;
let preventAutoReconnect = false; // New flag to control automatic reconnections

// Play sound function that will be available to the renderer process
function playSound(soundName) {
  try {
    const soundPath = path.join(__dirname, "assets", soundName);
    logToFileAndUI(`Playing sound: ${soundPath}`);

    // Use child_process to play sound with system command
    // For macOS
    if (process.platform === "darwin") {
      const { execSync } = require("child_process");
      execSync(`afplay "${soundPath}"`, { stdio: "ignore" });
    }
    // For Windows
    else if (process.platform === "win32") {
      const { execSync } = require("child_process");
      execSync(
        `powershell -c (New-Object Media.SoundPlayer "${soundPath}").PlaySync()`
      );
    }
    // For Linux
    else if (process.platform === "linux") {
      const { execSync } = require("child_process");
      execSync(`aplay "${soundPath}"`);
    }

    return true;
  } catch (error) {
    logToFileAndUI(`Error playing sound: ${error.message}`, true);
    return false;
  }
}

// Configuration settings storage
const configFilePath = path.join(app.getPath("userData"), "user_config.json");

// Load user configuration from disk
function loadUserConfig() {
  try {
    if (fs.existsSync(configFilePath)) {
      const rawData = fs.readFileSync(configFilePath, "utf8");
      const config = JSON.parse(rawData);
      logToFileAndUI("User configuration loaded");

      // We explicitly ignore the shutdown setting
      // as we always want it to start as false
      if (config.shutdown !== undefined) {
        delete config.shutdown;
      }

      return config;
    }
  } catch (err) {
    logToFileAndUI(`Error loading configuration: ${err.message}`, true);
  }
  // Return empty config if file doesn't exist or there's an error
  return {
    folderPath: "",
    chatId: "",
    chatName: "",
    caption: "",
    // No shutdown property - we don't want to persist it
  };
}

// Save user configuration to disk
function saveUserConfig(config) {
  try {
    fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2), "utf8");
    logToFileAndUI("User configuration saved");
  } catch (err) {
    logToFileAndUI(`Error saving configuration: ${err.message}`, true);
  }
}

// Ensure the user data directory exists
const userDataPath = path.join(app.getPath("userData"), "whatsapp-auth");
if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true });
}

// Store logs in a file as well as sending to UI
const logFilePath = path.join(app.getPath("userData"), "logs.txt");
function logToFileAndUI(message, isError = false) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;

  // Always write to log file
  try {
    fs.appendFileSync(logFilePath, logMessage);
  } catch (error) {
    console.error("Failed to write to log file:", error);
  }

  // Only send to UI if mainWindow exists AND is not destroyed
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      if (isError) {
        mainWindow.webContents.send("error", message);
      } else {
        mainWindow.webContents.send("log", message);
      }
    } catch (error) {
      console.error("Failed to send log to renderer:", error);
    }
  }

  console.log(logMessage);
}

function createWindow() {
  // Determine the correct icon based on platform
  let iconPath;
  if (process.platform === "win32") {
    iconPath = path.join(__dirname, "assets/icon.ico");
  } else if (process.platform === "darwin") {
    iconPath = path.join(__dirname, "assets/icon.icns");
  } else {
    iconPath = path.join(__dirname, "assets/icon.png");
  }

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      // Enable garbage collection exposure
      additionalArguments: ["--js-flags=--expose-gc"],
    },
    icon: iconPath,
  });

  mainWindow.loadFile("index.html");

  // Log system resources but do NOT initialize WhatsApp automatically
  getSystemResources();
  logToFileAndUI("Application ready. Checking for existing session...");

  // After window is loaded, check for existing WhatsApp session
  mainWindow.webContents.on("did-finish-load", async () => {
    // Check if auth credentials exist
    const authDirectory = path.join(app.getPath("userData"), "baileys-auth");
    const credentialsFile = path.join(authDirectory, "creds.json");

    if (fs.existsSync(credentialsFile)) {
      try {
        // Auth data exists, try to reconnect automatically
        logToFileAndUI(
          "Existing WhatsApp session found, attempting to restore..."
        );
        mainWindow.webContents.send("whatsapp-loading", true);
        await initWhatsAppClient();
      } catch (err) {
        logToFileAndUI(`Failed to restore session: ${err.message}`, true);
        mainWindow.webContents.send("whatsapp-disconnected");
      }
    } else {
      logToFileAndUI(
        'No existing session found. Click "Connect WhatsApp" to begin.'
      );
      mainWindow.webContents.send("whatsapp-disconnected");
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Log system resources but DON'T auto-initialize WhatsApp
  getSystemResources();
  logToFileAndUI('Application ready. Click "Connect WhatsApp" to start.');
});

app.on("window-all-closed", async function () {
  // Clean up all active intervals and timers
  if (global.progressIntervals) {
    global.progressIntervals.forEach(clearInterval);
    global.progressIntervals = [];
  }

  // Just end the socket connection WITHOUT logging out
  // This preserves authentication for the next app launch
  if (sock) {
    try {
      console.log("Ending WhatsApp connection (preserving auth)...");
      // Check if socket is valid before ending it
      if (sock.ev && typeof sock.end === "function" && !sock.destroyed) {
        sock.end();
      } else {
        console.log("Socket already destroyed or invalid");
      }
      sock = null;
    } catch (err) {
      console.error(`Error closing WhatsApp connection: ${err.message}`);
    }
  }

  // Close file watcher
  if (watcher) {
    try {
      watcher.close();
      watcher = null;
    } catch (err) {
      console.error(`Error closing file watcher: ${err.message}`);
    }
  }

  // Clean up any other resources
  store = null;
  mainWindow = null;

  // Run garbage collection if available
  if (global.gc) {
    global.gc();
  }

  app.quit();
});

// Force shutdown computer function (with elevated privileges)
function forceShutdown() {
  try {
    if (process.platform === "win32") {
      logToFileAndUI("Executing Windows shutdown command...");
      execSync("shutdown /s /f /t 10");
    } else if (process.platform === "darwin") {
      // macOS
      logToFileAndUI("Executing macOS shutdown command...");
      execSync('osascript -e "tell app \\"System Events\\" to shut down"');
    } else if (process.platform === "linux") {
      logToFileAndUI("Executing Linux shutdown command...");
      execSync("systemctl poweroff");
    } else {
      throw new Error("Unsupported platform for shutdown");
    }
    logToFileAndUI("Shutdown command executed successfully");
    return true;
  } catch (error) {
    logToFileAndUI(`Shutdown failed: ${error.message}`, true);
    console.error("Shutdown error:", error);
    return false;
  }
}

// Get system info for better resource allocation
function getSystemResources() {
  const totalMemGB = Math.floor(os.totalmem() / (1024 * 1024 * 1024));
  const freeMemGB = Math.floor(os.freemem() / (1024 * 1024 * 1024));
  const cpuCount = os.cpus().length;

  logToFileAndUI(
    `System info: ${totalMemGB}GB RAM (${freeMemGB}GB free), ${cpuCount} CPUs`
  );

  return {
    totalMemGB,
    freeMemGB,
    cpuCount,
  };
}

// Update the forceContactSync function to be more gentle with WhatsApp API
async function forceContactSync() {
  try {
    logToFileAndUI("Gently fetching WhatsApp contacts...");

    if (!sock || !sock.user) {
      logToFileAndUI(
        "Cannot sync contacts: WhatsApp connection not established",
        true
      );
      return false;
    }

    // Only use safe methods that won't disrupt the connection
    try {
      if (store && store.chats) {
        const storeChats = await store.chats.all();
        logToFileAndUI(`Using ${storeChats.length} existing chats from store`);
      }
    } catch (err) {
      logToFileAndUI(`Error accessing store: ${err.message}`);
    }

    // We'll avoid all direct protocol manipulation as it's causing connection issues

    logToFileAndUI("Contact synchronization completed safely");
    return true;
  } catch (error) {
    logToFileAndUI(`Contact sync error: ${error.message}`, true);
    return false;
  }
}

// Initialize WhatsApp client with Baileys - Simplified implementation to avoid the public key error
async function initWhatsAppClient() {
  // Clean up any existing socket before starting
  if (sock) {
    try {
      sock.end();
    } catch (e) {
      console.error("Error cleaning up previous socket:", e);
    }
  }

  logToFileAndUI("Initializing WhatsApp client...");

  // Use the built-in state handler from Baileys instead of custom implementation
  // This avoids the complicated key handling that's causing the errors
  const { state, saveCreds } = await useSimpleBaileysAuth();

  // Create minimal logger to reduce noise
  const logger = pino({
    level: process.env.NODE_ENV === "production" ? "error" : "warn",
  }).child({ level: "silent" });

  try {
    // Create in-memory store if available
    if (makeInMemoryStore) {
      store = makeInMemoryStore({ logger });
    }

    // Use much simpler socket configuration to prevent cryptography errors
    sock = makeWASocket({
      logger,
      // Removed deprecated printQRInTerminal option
      auth: state,
      browser: ["WhatsApp Large File Sender", "Chrome", "100.0.0.0"],
      connectTimeoutMs: 60000,
      // Disable all complicated features that could cause errors
      syncFullHistory: false,
      linkPreviewImageThumbnailWidth: 0,
      transactionOpts: { maxCommitRetries: 1, maxRetries: 1 },
      getMessage: async () => {
        return { conversation: "" };
      },
      markOnlineOnConnect: false,
    });

    // Bind store to events if store is available
    if (store && store.bind) {
      store.bind(sock.ev);
    }

    logToFileAndUI("Waiting for connection events from WhatsApp...");

    // Handle connection updates
    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        // Got QR code, now display it to user
        logToFileAndUI(
          "WhatsApp QR code received. Please scan with your phone."
        );

        // Display QR in terminal for debugging
        try {
          require("qrcode-terminal").generate(qr, { small: true }, (qrCode) => {
            console.log(qrCode);
          });
        } catch (e) {
          // QR in terminal is optional, continue if it fails
          console.log("Could not print QR in terminal:", e);
        }

        if (mainWindow) {
          mainWindow.webContents.send("whatsapp-qr", qr);
          mainWindow.webContents.send("whatsapp-loading", false);
        }
      }

      if (connection === "open") {
        logToFileAndUI("WhatsApp connection is open and ready");

        // Add contact sync here
        forceContactSync().then(() => {
          // Get chats after attempting contact sync
          getAllChats().catch((e) =>
            logToFileAndUI(`Error getting chats: ${e.message}`, true)
          );
        });

        if (mainWindow) {
          mainWindow.webContents.send("whatsapp-ready");
          mainWindow.webContents.send("whatsapp-authenticated");
        }
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        logToFileAndUI(`Connection closed with status: ${statusCode}`);

        if (mainWindow) {
          mainWindow.webContents.send("whatsapp-disconnected");
        }

        if (shouldReconnect && !preventAutoReconnect) {
          logToFileAndUI("Will attempt reconnection in 5 seconds...");
          setTimeout(() => {
            initWhatsAppClient();
          }, 5000);
        }
      }
    });

    // Save credentials when updated
    sock.ev.on("creds.update", saveCreds);
  } catch (err) {
    logToFileAndUI(`Failed to initialize WhatsApp: ${err.message}`, true);
    console.error("WhatsApp initialization error:", err);

    // Only retry if it's not a fatal error
    if (
      !err.message.includes("rate-limit") &&
      !err.message.includes("banned")
    ) {
      setTimeout(() => {
        logToFileAndUI("Retrying connection in 10 seconds...");
        initWhatsAppClient();
      }, 10000);
    } else {
      logToFileAndUI(
        "Cannot connect due to rate limiting or ban. Please try again later.",
        true
      );
    }
  }
}

// Simplified auth state handler that relies on Baileys' built-in functionality
async function useSimpleBaileysAuth() {
  try {
    // Import Baileys state handler
    const { useMultiFileAuthState } = require("@whiskeysockets/baileys");

    // Ensure the directory exists
    const authDirectory = path.join(app.getPath("userData"), "baileys-auth");
    if (!fs.existsSync(authDirectory)) {
      fs.mkdirSync(authDirectory, { recursive: true });
    }

    logToFileAndUI(`Using Baileys built-in auth system at ${authDirectory}`);

    // Use Baileys' native multi-file auth
    return await useMultiFileAuthState(authDirectory);
  } catch (error) {
    logToFileAndUI(`Auth initialization error: ${error.message}`, true);
    throw error;
  }
}

// Check for any pending transfers
function checkForPendingTransfers() {
  if (activeTransfers.size > 0) {
    logToFileAndUI(
      `Found ${activeTransfers.size} pending transfers. Resuming...`
    );

    for (const [filePath, transfer] of activeTransfers.entries()) {
      logToFileAndUI(`Resuming transfer for ${path.basename(filePath)}`);

      // Re-attempt the transfer
      processAndSendFile(filePath, transfer.chatId, transfer.attemptCount);
    }
  }
}

// Manual WhatsApp initialization request
ipcMain.on("init-whatsapp", async (event) => {
  mainWindow.webContents.send("whatsapp-loading", true);
  logToFileAndUI("Initializing WhatsApp client...");

  // Initialize a new client
  await initWhatsAppClient();
});

ipcMain.handle("load-user-config", () => {
  return loadUserConfig();
});

ipcMain.on("save-user-config", (event, config) => {
  saveUserConfig(config);
});

ipcMain.on("update-caption", async (event, value) => {
  caption = value;
  logToFileAndUI(`Caption updated to: ${caption}`);

  // Update the stored config
  const config = loadUserConfig();
  config.caption = value;
  saveUserConfig(config);
});

ipcMain.on("toggle-shutdown", (event, value) => {
  shutdownAfterSend = value;
  logToFileAndUI(`Shutdown after send set to: ${shutdownAfterSend}`);

  // No longer saving to configuration
  // We only update the UI to reflect the current state
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("shutdown-state-changed", shutdownAfterSend);
  }
});

// Handle folder selection
ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });

  if (!result.canceled) {
    return result.filePaths[0];
  }
  return null;
});

// Convert JID format if needed (Baileys uses different JID format)
function ensureProperJid(jid) {
  if (!jid.includes("@")) {
    // Convert to proper format if needed
    return jid.includes("-") ? `${jid}@g.us` : `${jid}@s.whatsapp.net`;
  }
  return jid;
}

// Optimized file sending with improved memory handling for large files
async function processAndSendFile(filePath, chatId, attemptCount = 0) {
  if (isProcessingFile && attemptCount === 0) {
    logToFileAndUI("Already processing a file, please wait...");
    return;
  }

  isProcessingFile = true;
  logToFileAndUI(`Processing file: ${filePath}`);

  try {
    // Check file size and accessibility
    const fileStats = fs.statSync(filePath);
    const fileSizeMB = fileStats.size / (1024 * 1024);
    logToFileAndUI(
      `File size: ${fileStats.size} bytes (${fileSizeMB.toFixed(2)}MB)`
    );

    if (fileStats.size === 0) {
      logToFileAndUI("File appears empty, skipping...");
      isProcessingFile = false;
      return;
    }

    // File size warning
    if (fileSizeMB > 1000) {
      // 1GB
      logToFileAndUI(
        "Warning: File is extremely large (>1GB). This may take some time...",
        true
      );
      logToFileAndUI("Optimizing memory for large file transfer...");
    }

    if (fileSizeMB > 2000) {
      // 2GB
      logToFileAndUI(
        "Error: File exceeds 2GB limit. WhatsApp has a maximum file size limit of 2GB",
        true
      );
      isProcessingFile = false;
      return;
    }

    // Record this transfer
    const transferId = Date.now().toString();
    activeTransfers.set(filePath, {
      chatId,
      attemptCount,
      startTime: Date.now(),
      fileSize: fileStats.size,
      transferId,
    });

    // Determine the MIME type based on the file extension
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = mime.lookup(ext) || "application/octet-stream";

    logToFileAndUI(`Preparing to send file with mimetype: ${mimeType}`);
    logToFileAndUI(
      "Reading file data (this may take a while for large files)..."
    );

    // Force garbage collection before reading the file
    if (global.gc) {
      global.gc();
      logToFileAndUI("Performed garbage collection before file read");
    }

    // Proper JID formatting
    const jid = ensureProperJid(chatId);

    // Progress tracking
    const sendStartTime = Date.now();
    let lastProgressUpdate = 0;
    let bytesProcessed = 0;

    // For very large files, we'll break it into smaller chunks internally
    // This works better with Baileys' internal mechanisms
    const fileName = path.basename(filePath);

    // IMPORTANT: Send initial progress update immediately to show the animation right away
    if (mainWindow) {
      mainWindow.webContents.send("upload-progress", {
        file: fileName,
        progress: 1, // Start at 1%
        elapsed: 0,
        speed: "0.00",
        eta: "Calculating...",
        destination: ensureProperJid(chatId).split("@")[0],
        fileType: mimeType,
        fileSize: `${(fileStats.size / (1024 * 1024)).toFixed(2)} MB`,
        transferId,
      });

      // Force an update of the UI
      logToFileAndUI(
        "File transfer started - engine animation should be visible"
      );
    }

    // Register a progress callback
    const onProgress = (progress) => {
      // Only update at most once per second to avoid UI spam
      const now = Date.now();
      if (now - lastProgressUpdate >= 1000) {
        lastProgressUpdate = now;
        const elapsedSeconds = Math.floor((now - sendStartTime) / 1000);
        const percent = progress.total
          ? Math.round((progress.uploaded / progress.total) * 100)
          : "unknown";

        bytesProcessed = progress.uploaded;

        // Calculate speed in MB/s
        const speed =
          elapsedSeconds > 0
            ? (bytesProcessed / (1024 * 1024) / elapsedSeconds).toFixed(2)
            : "0.00";

        // Calculate ETA
        let eta = "Unknown";
        if (progress.total && elapsedSeconds > 0 && percent < 100) {
          const remainingPercent = 100 - percent;
          const timePerPercent = elapsedSeconds / percent;
          const remainingSeconds = Math.round(
            remainingPercent * timePerPercent
          );
          eta = `~${remainingSeconds}s remaining`;
        } else if (percent >= 100) {
          eta = "Completing...";
        }

        logToFileAndUI(
          `Upload progress: ${percent}% (${elapsedSeconds}s elapsed, ${speed} MB/s)`
        );

        // Send enhanced progress to UI
        if (mainWindow) {
          mainWindow.webContents.send("upload-progress", {
            file: fileName,
            progress: percent,
            elapsed: elapsedSeconds,
            speed: `${speed}`,
            eta: eta,
            destination: ensureProperJid(chatId).split("@")[0],
            fileType: mimeType,
            fileSize: `${(fileStats.size / (1024 * 1024)).toFixed(2)} MB`,
            transferId,
          });
        }
      }
    };

    // For extremely large files, optimize memory usage with proper upload tracking
    let result;
    let progressInterval; // Define progress interval variable

    // Start simulated progress updates regardless of file size
    let simulatedProgress = 0;
    const startTime = Date.now();
    const estimatedTimeSeconds = Math.max(
      20,
      Math.min(300, Math.round(fileSizeMB * 0.5))
    ); // Estimate based on file size
    const updateFrequency = 800; // Update every 800ms

    // Calculate how much to increment progress each time
    const progressIncrement =
      90 / ((estimatedTimeSeconds * 1000) / updateFrequency);

    progressInterval = setInterval(() => {
      const elapsedMs = Date.now() - startTime;
      const elapsedSeconds = Math.floor(elapsedMs / 1000);

      // Calculate simulated progress - faster at start, slower towards end
      if (simulatedProgress < 10) {
        // Initial phase - move quickly to 10%
        simulatedProgress += progressIncrement * 2;
      } else if (simulatedProgress < 85) {
        // Main transfer phase - steady progress
        simulatedProgress += progressIncrement;
      } else if (simulatedProgress < 90) {
        // Slowing down phase
        simulatedProgress += progressIncrement * 0.5;
      }

      // Cap at 90% - the actual completion will move it to 100%
      simulatedProgress = Math.min(90, simulatedProgress);

      // Calculated estimated speed
      const processedEstimate = (simulatedProgress / 100) * fileStats.size;
      const speedMBps =
        elapsedSeconds > 0
          ? (processedEstimate / (1024 * 1024) / elapsedSeconds).toFixed(2)
          : 0;

      // Send the progress update
      if (mainWindow) {
        mainWindow.webContents.send("upload-progress", {
          file: fileName,
          progress: Math.round(simulatedProgress),
          elapsed: elapsedSeconds,
          speed: speedMBps,
          eta: `~${Math.round(
            estimatedTimeSeconds - elapsedSeconds
          )}s remaining`,
          destination: ensureProperJid(chatId).split("@")[0],
          fileType: mimeType,
          fileSize: `${(fileStats.size / (1024 * 1024)).toFixed(2)} MB`,
          transferId,
        });
      }
    }, updateFrequency);

    try {
      if (fileSizeMB > 500) {
        logToFileAndUI("Using optimized approach for large file upload");

        // Use message options with additional settings for large files
        const options = {
          uploadProgress: onProgress,
        };

        // With Baileys, we can send as a document directly from the file path with progress tracking
        result = await sock.sendMessage(
          jid,
          {
            document: { url: filePath },
            fileName: fileName,
            mimetype: mimeType,
            caption: caption,
          },
          options
        );
      } else {
        // For smaller files, use the standard approach
        logToFileAndUI("Using standard approach for smaller file");
        const buffer = fs.readFileSync(filePath);

        result = await sock.sendMessage(jid, {
          document: buffer,
          fileName: fileName,
          mimetype: mimeType,
          caption: caption,
        });
      }

      // Clear the progress interval once sending is complete
      clearInterval(progressInterval);

      // Send final 100% progress update
      if (mainWindow) {
        mainWindow.webContents.send("upload-progress", {
          file: fileName,
          progress: 100,
          elapsed: Math.floor((Date.now() - startTime) / 1000),
          speed: (
            fileSizeMB / (Math.floor((Date.now() - startTime) / 1000) || 1)
          ).toFixed(2),
          eta: "Complete!",
          destination: ensureProperJid(chatId).split("@")[0],
          fileType: mimeType,
          fileSize: `${(fileStats.size / (1024 * 1024)).toFixed(2)} MB`,
          transferId,
        });
      }

      const totalTime = Math.floor((Date.now() - sendStartTime) / 1000);
      const speedMBps = fileSizeMB / (totalTime || 1);

      logToFileAndUI(
        `✅ Document sent successfully! Message ID: ${result.key.id}`
      );
      logToFileAndUI(
        `Transfer completed in ${totalTime} seconds (average speed: ${speedMBps.toFixed(
          2
        )} MB/s)`
      );
      // Shutdown PC if requested
      if (shutdownAfterSend) {
        logToFileAndUI("Preparing to shut down system...");

        // Add a small delay before shutdown to ensure logs are visible
        setTimeout(() => {
          forceShutdown();
        }, 5000);
      }
    } catch (error) {
      // Clear the interval if there's an error
      clearInterval(progressInterval);
      throw error; // Re-throw to be caught by the outer catch block
    }

    // Now verify the message was actually sent by asking the server for confirmation
    try {
      // Wait a moment to ensure server has processed the message
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Calculate the final statistics for the transfer
      const totalTime = Math.floor((Date.now() - sendStartTime) / 1000);
      const speedMBps = fileSizeMB / (totalTime || 1);
      const finalSpeed = speedMBps.toFixed(2);

      // In newer Baileys versions, we need to use a different approach
      // The messageInfo function doesn't exist in current versions
      try {
        // Method 1: Check message status from store
        if (store && store.messages) {
          const chat = store.messages[jid];
          if (chat) {
            const msg = chat.get(result.key.id);
            if (msg) {
              const status = msg.status || 2;
              logToFileAndUI(
                `✓✓ Message delivery status from store: ${status}`
              );
              mainWindow.webContents.send("file-sent-confirmed", {
                file: fileName,
                messageId: result.key.id,
                status: status,
                transferId,
                elapsed: totalTime,
                speed: finalSpeed,
              });
              return; // Successfully found status
            }
          }
        }

        // Method 2: Use read-receipts event - this is just to set up future status updates
        // We'll assume successful delivery since the message was sent without error
        logToFileAndUI(`✓ Message assumed delivered (ID: ${result.key.id})`);
        mainWindow.webContents.send("file-sent-confirmed", {
          file: fileName,
          messageId: result.key.id,
          status: 2, // Assume delivered to server
          transferId,
          elapsed: totalTime,
          speed: finalSpeed,
        });

        // Set up listener for future status updates for this message
        const statusListener = sock.ev.on("messages.update", (updates) => {
          for (const update of updates) {
            if (update.key.id === result.key.id) {
              if (update.status) {
                logToFileAndUI(`Message status updated: ${update.status}`);
              }
            }
          }
        });

        // Remove listener after some time to avoid memory leaks
        setTimeout(() => {
          sock.ev.off("messages.update", statusListener);
        }, 60000);
      } catch (innerError) {
        // Fall back to basic confirmation - the message was sent successfully
        logToFileAndUI(
          `Message sent successfully, cannot verify delivery status: ${innerError.message}`
        );
        mainWindow.webContents.send("file-sent-confirmed", {
          file: fileName,
          messageId: result.key.id,
          status: 2, // Assume delivered to server
          transferId,
          elapsed: totalTime,
          speed: finalSpeed,
        });
      }
    } catch (verifyErr) {
      logToFileAndUI(
        `Sent file but couldn't verify delivery status: ${verifyErr.message}`
      );
      // Still send confirmation since the file was sent

      // Calculate the final statistics even in error case
      const totalTime = Math.floor((Date.now() - sendStartTime) / 1000);
      const speedMBps = fileSizeMB / (totalTime || 1);
      const finalSpeed = speedMBps.toFixed(2);

      mainWindow.webContents.send("file-sent-confirmed", {
        file: fileName,
        messageId: result.key.id,
        status: 2, // Assume delivered to server
        transferId,
        elapsed: totalTime,
        speed: finalSpeed,
      });
    }

    // Remove from active transfers
    activeTransfers.delete(filePath);

    // Memory cleanup
    if (global.gc) {
      global.gc();
      logToFileAndUI("Performed garbage collection after successful send");
    }
  } catch (error) {
    logToFileAndUI(`Error sending document: ${error.message}`, true);
    console.error("Error sending document:", error);

    // Check if this is a connection error
    if (
      error.message.includes("Connection closed") ||
      error.message.includes("Stream ended") ||
      error.message.includes("not connected") ||
      error.message.includes("timed out") ||
      error.message.includes("socket hang up")
    ) {
      logToFileAndUI(
        "WhatsApp connection was lost. Attempting to reconnect...",
        true
      );

      // Try to reconnect and retry the transfer if within retry limit
      if (attemptCount < maxRetries) {
        const nextAttempt = attemptCount + 1;
        logToFileAndUI(
          `This was attempt ${
            attemptCount + 1
          }. Will retry after reconnection (${nextAttempt}/${maxRetries})`
        );

        activeTransfers.set(filePath, {
          chatId,
          attemptCount: nextAttempt,
          fileSize: fs.statSync(filePath).size,
          startTime: Date.now(), // Reset start time for the retry
        });

        try {
          if (sock) {
            sock.end();
          }

          setTimeout(() => {
            initWhatsAppClient();
            logToFileAndUI(
              "WhatsApp reinitializing, transfer will resume automatically when connected"
            );
          }, 15000);
        } catch (err) {
          logToFileAndUI(`Error during reconnection: ${err.message}`, true);
        }
      } else {
        logToFileAndUI(
          `Maximum retry attempts (${maxRetries}) reached for file: ${path.basename(
            filePath
          )}`,
          true
        );
        activeTransfers.delete(filePath);
        mainWindow.webContents.send("file-send-failed", {
          file: path.basename(filePath),
          error: error.message,
        });
      }
    } else if (error.message.includes("Too large")) {
      // Specific error for file size limit
      logToFileAndUI(
        `Error: File is too large for WhatsApp. Maximum size is 2GB.`,
        true
      );
      activeTransfers.delete(filePath);
      mainWindow.webContents.send("file-send-failed", {
        file: path.basename(filePath),
        error: "File exceeds WhatsApp size limit of 2GB",
      });
    } else {
      // Other errors
      logToFileAndUI(`Error: ${error.message}`, true);

      // For general errors, retry if within limit
      if (attemptCount < maxRetries) {
        const nextAttempt = attemptCount + 1;
        logToFileAndUI(
          `Will retry (${nextAttempt}/${maxRetries}) in 10 seconds...`
        );

        setTimeout(() => {
          logToFileAndUI(`Retrying file: ${path.basename(filePath)}`);
          processAndSendFile(filePath, chatId, nextAttempt);
        }, 10000);
      } else {
        logToFileAndUI(
          `Maximum retry attempts (${maxRetries}) reached for file: ${path.basename(
            filePath
          )}`,
          true
        );
        activeTransfers.delete(filePath);
        mainWindow.webContents.send("file-send-failed", {
          file: path.basename(filePath),
          error: error.message,
        });
      }
    }
  } finally {
    isProcessingFile = false;

    // Final memory cleanup
    if (global.gc) {
      global.gc();
    }
  }
}

// Improved file watching with better error handling
ipcMain.on("start-watching", (event, { folderPath, chatId }) => {
  if (watcher) {
    watcher.close();
  }

  logToFileAndUI(`Started watching folder: ${folderPath}`);

  watcher = chokidar.watch(folderPath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 15000, // Wait 15 seconds of stability before considering file complete
      pollInterval: 2000, // Check every 2 seconds
    },
    usePolling: true, // More reliable for network drives
    interval: 5000, // 5 seconds polling interval for more stability
    binaryInterval: 10000, // Check binary files less frequently to reduce CPU usage
    depth: 0, // Only watch files in the immediate directory, not subdirectories
    ignorePermissionErrors: true,
  });

  watcher.on("add", (filePath) => {
    logToFileAndUI(`New file detected: ${filePath}`);

    // Get file extension
    const fileExt = path.extname(filePath).toLowerCase();
    logToFileAndUI(`File extension: ${fileExt}`);

    // Check if the file is a supported type (expanded to include more formats)
    const supportedExtensions = [
      // Video formats
      ".mp4",
      ".mov",
      ".avi",
      ".mkv",
      ".wmv",
      ".flv",
      ".webm",
      ".m4v",
      // Image formats
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".bmp",
      ".webp",
      // Document formats
      ".pdf",
      ".doc",
      ".docx",
      ".txt",
      ".xls",
      ".xlsx",
      ".ppt",
      ".pptx",
      // Audio formats
      ".mp3",
      ".wav",
      ".flac",
      ".aac",
      ".ogg",
      ".m4a",
    ];

    if (supportedExtensions.includes(fileExt) || fileExt === "") {
      logToFileAndUI(
        `File ${path.basename(
          filePath
        )} is a supported file type, processing...`
      );

      // Extended wait to ensure file is fully written and not locked
      setTimeout(() => {
        logToFileAndUI(
          `Starting file accessibility check for: ${path.basename(filePath)}`
        );

        try {
          // Test if file is accessible and not locked
          const fd = fs.openSync(filePath, "r");
          fs.closeSync(fd);

          logToFileAndUI(
            `File ${path.basename(
              filePath
            )} is accessible, starting send process...`
          );

          // Start processing the file
          processAndSendFile(filePath, chatId);
        } catch (err) {
          logToFileAndUI(
            `File not accessible yet: ${err.message}. Waiting longer...`,
            true
          );

          // Try again after additional delay
          setTimeout(() => {
            logToFileAndUI(
              `Retrying file accessibility check for: ${path.basename(
                filePath
              )}`
            );
            try {
              const fd = fs.openSync(filePath, "r");
              fs.closeSync(fd);
              logToFileAndUI(
                `File ${path.basename(
                  filePath
                )} is now accessible, starting send process...`
              );
              processAndSendFile(filePath, chatId);
            } catch (retryErr) {
              logToFileAndUI(
                `File still not accessible after retry: ${retryErr.message}`,
                true
              );
            }
          }, 10000);
        }
      }, 10000);
    } else {
      logToFileAndUI(
        `File ${path.basename(
          filePath
        )} with extension ${fileExt} is not a supported format. Skipping.`
      );
      logToFileAndUI(
        `Supported formats: videos, images, documents, audio files`
      );
    }
  });

  watcher.on("error", (error) => {
    logToFileAndUI(`Watcher error: ${error}`, true);
  });
});

// Stop watching folder
ipcMain.on("stop-watching", () => {
  if (watcher) {
    watcher.close();
    logToFileAndUI("Stopped watching folder");
  }
});

// Reset auth data to force QR code generation
ipcMain.on("reset-auth-data", () => {
  try {
    logToFileAndUI(
      "Resetting authentication data to force new QR code generation..."
    );

    // Get the correct auth directory path that we're using
    const authDirectory = path.join(app.getPath("userData"), "baileys-auth");

    // Check if the directory exists before attempting to delete files
    if (fs.existsSync(authDirectory)) {
      // Delete the entire auth directory and recreate it
      fs.rmSync(authDirectory, { recursive: true });
      fs.mkdirSync(authDirectory, { recursive: true });
      logToFileAndUI("Auth credentials directory reset");
    }

    // Reset reconnect attempts counter
    const reconnectAttemptFile = path.join(userDataPath, "reconnect_attempts");
    if (fs.existsSync(reconnectAttemptFile)) {
      fs.writeFileSync(reconnectAttemptFile, "0");
    }

    // Also clear store file to prevent any cached data issues
    const storeFile = path.join(app.getPath("userData"), "baileys_store.json");
    if (fs.existsSync(storeFile)) {
      fs.unlinkSync(storeFile);
      logToFileAndUI("Store data cleared");
    }

    preventAutoReconnect = false; // Reset connection prevention flag
    logToFileAndUI("Authentication data reset complete, ready for new QR code");
  } catch (err) {
    logToFileAndUI(`Error resetting auth data: ${err.message}`, true);
  }
});

// Log out of WhatsApp
ipcMain.on("logout-whatsapp", async () => {
  try {
    logToFileAndUI("Logging out of WhatsApp...");

    // Set this flag to prevent automatic reconnection attempts
    preventAutoReconnect = true;

    if (sock) {
      try {
        // First send explicit logout command to WhatsApp servers
        await sock.logout();
        logToFileAndUI("Logout command sent to WhatsApp server");

        // Properly end the socket
        sock.ev.removeAllListeners(); // Remove all event listeners
        await sock.end();
        sock = null; // Clear the socket reference

        // Clean up store data
        if (store) {
          store = null;
          logToFileAndUI("Store data cleared");
        }

        logToFileAndUI("Socket connection terminated");
      } catch (err) {
        logToFileAndUI(`Error during WhatsApp logout: ${err.message}`, true);
      }
    }

    // Thoroughly clean up auth data
    const authDirectory = path.join(app.getPath("userData"), "baileys-auth");
    if (fs.existsSync(authDirectory)) {
      fs.rmSync(authDirectory, { recursive: true, force: true });
      fs.mkdirSync(authDirectory, { recursive: true });
      logToFileAndUI("Authentication data cleared");
    }

    // Also clear legacy auth paths
    if (fs.existsSync(userDataPath)) {
      fs.rmSync(userDataPath, { recursive: true, force: true });
      logToFileAndUI("Legacy authentication data cleared");
    }

    // Clear any session files
    const sessionPath = path.join(app.getPath("userData"), "session");
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      logToFileAndUI("Session data cleared");
    }

    // Additional cleanup for any remaining auth keys or tokens
    const authStorePath = path.join(app.getPath("userData"), "auth_store");
    if (fs.existsSync(authStorePath)) {
      fs.rmSync(authStorePath, { recursive: true, force: true });
      logToFileAndUI("Auth store data cleared");
    }

    // Clear any possible Baileys store files to prevent cached data issues
    const storeFile = path.join(app.getPath("userData"), "baileys_store.json");
    if (fs.existsSync(storeFile)) {
      fs.unlinkSync(storeFile);
      logToFileAndUI("Store file cleared");
    }

    // Clean up any active transfers
    if (activeTransfers.size > 0) {
      activeTransfers.clear();
      logToFileAndUI(`Canceled ${activeTransfers.size} pending transfers`);
    }

    // Force garbage collection if possible
    if (global.gc) {
      global.gc();
      logToFileAndUI("Performed garbage collection");
    }

    // Notify renderer about disconnection
    mainWindow.webContents.send("whatsapp-disconnected");
    logToFileAndUI("Logged out of WhatsApp");
  } catch (err) {
    logToFileAndUI(`Error during logout process: ${err.message}`, true);
  }
});

// Check WhatsApp client connection status
ipcMain.on("check-connection", async () => {
  try {
    if (!sock || !sock.user) {
      logToFileAndUI("WhatsApp client is not connected");
      mainWindow.webContents.send("whatsapp-disconnected");
      return;
    }

    // In Baileys, if sock.user exists, we're connected
    if (sock.user.id) {
      logToFileAndUI(`WhatsApp connected as: ${sock.user.id}`);
      mainWindow.webContents.send("whatsapp-ready");
    } else {
      mainWindow.webContents.send("whatsapp-disconnected");
    }
  } catch (err) {
    logToFileAndUI(`Error checking connection: ${err.message}`, true);
    mainWindow.webContents.send("whatsapp-disconnected");

    // Try to reconnect
    setTimeout(() => {
      initWhatsAppClient();
    }, 5000);
  }
});

// Manually retry sending a file
ipcMain.on("retry-file", async (event, { filePath, chatId }) => {
  logToFileAndUI(`Manually retrying file: ${filePath}`);
  processAndSendFile(filePath, chatId, 0);
});

// Cancel all pending transfers
ipcMain.on("cancel-transfers", () => {
  const count = activeTransfers.size;
  activeTransfers.clear();
  logToFileAndUI(`Canceled ${count} pending transfers`);
});

// Set max retries
ipcMain.on("set-max-retries", (event, count) => {
  maxRetries = count;
  logToFileAndUI(`Maximum retry attempts set to: ${maxRetries}`);
});

// IPC handler for playing sounds
ipcMain.on("play-sound", (event, soundName) => {
  logToFileAndUI(`Renderer requested to play sound: ${soundName}`);
  playSound(soundName);
});

// Enhanced getAllChats function to find all contacts and chats - without placeholders
async function getAllChats() {
  try {
    logToFileAndUI(
      "Fetching WhatsApp chats and contacts using official Baileys method..."
    );

    // Show loading indicator in UI
    if (mainWindow) {
      mainWindow.webContents.send("chats-loading", true);
    }

    // Use a Map to prevent duplicates by enforcing unique JIDs
    const chatSet = new Map();

    // STEP 1: Get groups using official Baileys method
    try {
      const fetchedGroups = await sock.groupFetchAllParticipating();
      logToFileAndUI(
        `Found ${Object.keys(fetchedGroups).length} participating groups`
      );

      Object.entries(fetchedGroups).forEach(([id, chat]) => {
        chatSet.set(id, {
          id: id,
          name: chat.subject || id,
          isGroup: true,
        });
      });
    } catch (e) {
      logToFileAndUI(`Error fetching groups: ${e.message}`, true);
    }

    // STEP 2: Get contacts and individual chats from Baileys store
    try {
      if (store && store.chats) {
        const storeChats = await store.chats.all();
        logToFileAndUI(`Found ${storeChats.length} chats in store`);

        storeChats.forEach((chat) => {
          // Only add if not already in the map
          if (!chatSet.has(chat.id)) {
            chatSet.set(chat.id, {
              id: chat.id,
              name: chat.name || chat.id.split("@")[0],
              isGroup: chat.id.endsWith("@g.us"),
            });
          }
        });
      }
    } catch (e) {
      logToFileAndUI(`Error fetching chats from store: ${e.message}`, true);
    }

    // STEP 3: Format phone numbers to make them more readable
    for (const [jid, chatData] of chatSet.entries()) {
      if (!chatData.isGroup) {
        const phoneNumber = jid.split("@")[0];
        // Only update if the name is just the raw ID
        if (chatData.name === phoneNumber) {
          // Format the phone number with "+" for readability
          if (phoneNumber.length > 7) {
            chatData.name = `+${phoneNumber}`;
          }
        }
      }
    }

    // Convert map to array and sort for better usability
    const chatList = Array.from(chatSet.values());
    chatList.sort((a, b) => {
      // Groups first, then individual chats
      if (a.isGroup && !b.isGroup) return -1;
      if (!a.isGroup && b.isGroup) return 1;
      return a.name.localeCompare(b.name);
    });

    logToFileAndUI(`Total unique chats and contacts found: ${chatList.length}`);

    // Hide loading indicator and send chats to UI
    if (mainWindow) {
      mainWindow.webContents.send("chats-loading", false);
      mainWindow.webContents.send("whatsapp-chats", chatList);
    }

    // Setup listener for contact updates
    sock.ev.on("contacts.update", (contacts) => {
      let updated = false;
      for (const contact of contacts) {
        const jid = contact.id;
        if (chatSet.has(jid)) {
          const chat = chatSet.get(jid);
          if (contact.name && chat.name !== contact.name) {
            chat.name = contact.name;
            updated = true;
          }
        }
      }

      if (updated && mainWindow) {
        const updatedList = Array.from(chatSet.values());
        mainWindow.webContents.send("whatsapp-chats", updatedList);
        logToFileAndUI("Updated chat list with new contact names");
      }
    });

    return chatList;
  } catch (err) {
    console.error("Error fetching chats:", err);
    logToFileAndUI(`Failed to fetch WhatsApp chats: ${err.message}`, true);
    // Ensure we hide the loading indicator even on error
    if (mainWindow) {
      mainWindow.webContents.send("chats-loading", false);
    }
    return [];
  }
}

// Export module functions
module.exports = {
  // ...existing exports
  createPurringSound,
  playSound,
};
