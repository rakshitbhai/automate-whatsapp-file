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

// Import utility modules
const {
  IPC_EVENTS,
  TIMEOUTS,
  WHATSAPP_CONFIG,
  FILE_SIZE_LIMITS,
  ALL_SUPPORTED_EXTENSIONS
} = require("./utils/constants");
const PlatformUtils = require("./utils/platform-utils");
const FileUtils = require("./utils/file-utils");
const ProgressTracker = require("./utils/progress-tracker");
const CleanupManager = require("./utils/cleanup-manager");
const Logger = require("./utils/logger");

// Store will be null for now since makeInMemoryStore import is problematic
let makeInMemoryStore = null;

// Global variables
let mainWindow;
let sock;
let store;
let watcher;
let caption = "";
let shutdownAfterSend = false; // Always start with shutdown disabled
let isProcessingFile = false;
let activeTransfers = new Map(); // Track active transfers
let maxRetries = WHATSAPP_CONFIG.DEFAULT_MAX_RETRIES;
let preventAutoReconnect = false; // New flag to control automatic reconnections

// Initialize cleanup manager and logger
const cleanupManager = new CleanupManager();
const logFilePath = path.join(app.getPath("userData"), "logs.txt");
const logger = new Logger(logFilePath);

// Configuration settings storage
const configFilePath = path.join(app.getPath("userData"), "user_config.json");

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

// Play sound function using platform utilities
// Play notification sound
function playSound(soundFile = 'Cat Serenity_10.wav') {
  PlatformUtils.playSound(soundFile);
}

// Load user configuration from disk
function loadUserConfig() {
  const config = FileUtils.readJsonFile(configFilePath, {
    folderPath: "",
    chatId: "",
    chatName: "",
    caption: "",
    // No shutdown property - we don't want to persist it
  });

  // We explicitly ignore the shutdown setting as we always want it to start as false
  if (config.shutdown !== undefined) {
    delete config.shutdown;
  }

  logger.info("User configuration loaded");
  return config;
}

// Save user configuration to disk
function saveUserConfig(config) {
  try {
    FileUtils.writeJsonFile(configFilePath, config);
    logger.info("User configuration saved");
  } catch (err) {
    logger.error(`Error saving configuration: ${err.message}`);
  }
}

// Ensure the user data directory exists
const userDataPath = path.join(app.getPath("userData"), "whatsapp-auth");
FileUtils.ensureDirectoryExists(userDataPath);

// Store logs in a file as well as sending to UI - replaced with Logger utility
function logToFileAndUI(message, isError = false) {
  logger.log(message, isError);
}

function createWindow() {
  // Use platform utilities for icon path
  const iconPath = PlatformUtils.getIconPath(path.join(__dirname, "assets"));

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

  // Set logger main window reference
  logger.setMainWindow(mainWindow);

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
        mainWindow.webContents.send(IPC_EVENTS.WHATSAPP_LOADING, true);
        await initWhatsAppClient();
      } catch (err) {
        logToFileAndUI(`Failed to restore session: ${err.message}`, true);
        mainWindow.webContents.send(IPC_EVENTS.WHATSAPP_DISCONNECTED);
      }
    } else {
      logToFileAndUI(
        'No existing session found. Click "Connect WhatsApp" to begin.'
      );
      mainWindow.webContents.send(IPC_EVENTS.WHATSAPP_DISCONNECTED);
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
  // Clean up using CleanupManager
  CleanupManager.cleanupIntervals(global.progressIntervals, logToFileAndUI);
  global.progressIntervals = [];

  // Clean up WhatsApp socket and store
  const { sock: cleanSock, store: cleanStore } = CleanupManager.cleanupWhatsAppSocket(sock, store, logToFileAndUI);
  sock = cleanSock;
  store = cleanStore;

  // Clean up file watcher
  watcher = CleanupManager.cleanupFileWatcher(watcher, logToFileAndUI);

  // Clean up any other resources
  mainWindow = null;

  // Run garbage collection
  CleanupManager.runGarbageCollection(logToFileAndUI);

  app.quit();
});

// Force shutdown computer function using platform utilities
function forceShutdown() {
  try {
    const platformInfo = PlatformUtils.getPlatformInfo();
    logToFileAndUI(`Executing ${platformInfo.platform} shutdown command...`);

    PlatformUtils.executeShutdown();
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

  const systemInfo = {
    totalMemGB,
    freeMemGB,
    cpuCount,
  };

  logger.logSystemInfo(systemInfo);
  return systemInfo;
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

ipcMain.on(IPC_EVENTS.TOGGLE_SHUTDOWN, (event, value) => {
  shutdownAfterSend = value;
  logToFileAndUI(`Shutdown after send set to: ${shutdownAfterSend}`);

  // Send the updated state to the renderer process
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send(IPC_EVENTS.SHUTDOWN_STATE_CHANGED, shutdownAfterSend);
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
  logger.info(`Processing file: ${filePath}`);

  try {
    // Validate file using FileUtils
    const fileValidation = FileUtils.validateFile(filePath);
    logger.logFileProcessing(filePath, fileValidation);

    if (fileValidation.isEmpty) {
      logToFileAndUI("File appears empty, skipping...");
      isProcessingFile = false;
      return;
    }

    if (fileValidation.exceedsWarningThreshold) {
      logToFileAndUI(
        "Warning: File is extremely large (>1GB). This may take some time...",
        true
      );
      logToFileAndUI("Optimizing memory for large file transfer...");
    }

    if (fileValidation.exceedsMaxSize) {
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
      fileSize: fileValidation.size,
      transferId,
    });

    // Get MIME type using FileUtils
    const mimeType = FileUtils.getMimeType(filePath);
    const fileName = path.basename(filePath);

    logToFileAndUI(`Preparing to send file with mimetype: ${mimeType}`);
    logToFileAndUI(
      "Reading file data (this may take a while for large files)..."
    );

    // Force garbage collection before reading the file
    CleanupManager.runGarbageCollection(logToFileAndUI);

    // Proper JID formatting
    const jid = ensureProperJid(chatId);

    // Initialize progress tracker
    const progressTracker = new ProgressTracker(
      fileName,
      fileValidation.size,
      ensureProperJid(chatId).split("@")[0],
      mimeType,
      transferId
    );

    // Send initial progress update
    if (mainWindow) {
      progressTracker.sendInitialUpdate((progressData) => {
        mainWindow.webContents.send(IPC_EVENTS.UPLOAD_PROGRESS, progressData);
      });
      logToFileAndUI("File transfer started - engine animation should be visible");
    }

    // Start simulated progress for better UX
    progressTracker.startSimulatedProgress(fileValidation.sizeMB, (progressData) => {
      if (mainWindow) {
        mainWindow.webContents.send(IPC_EVENTS.UPLOAD_PROGRESS, progressData);
      }
    });

    const sendStartTime = Date.now();
    let result;

    try {
      if (fileValidation.isLarge) {
        logToFileAndUI("Using optimized approach for large file upload");

        const options = {
          uploadProgress: (progress) => {
            progressTracker.processRealProgress(progress, (progressData) => {
              if (mainWindow) {
                mainWindow.webContents.send(IPC_EVENTS.UPLOAD_PROGRESS, progressData);
              }
            });
          },
        };

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

      // Clean up progress tracker
      progressTracker.cleanup();

      // Send final completion update
      const totalTime = Math.floor((Date.now() - sendStartTime) / 1000);
      if (mainWindow) {
        progressTracker.sendCompletionUpdate((progressData) => {
          mainWindow.webContents.send(IPC_EVENTS.UPLOAD_PROGRESS, progressData);
        }, totalTime);
      }

      const speedMBps = fileValidation.sizeMB / (totalTime || 1);
      logger.logTransferCompletion(result.key.id, totalTime, speedMBps);

      // Shutdown PC if requested
      if (shutdownAfterSend) {
        logToFileAndUI("Preparing to shut down system...");
        setTimeout(() => {
          forceShutdown();
        }, TIMEOUTS.SHUTDOWN_DELAY_MS);
      }
    } catch (error) {
      progressTracker.cleanup();
      throw error;
    }

    // Handle message verification and confirmation (keeping existing logic)
    await handleMessageVerification(result, fileName, transferId, sendStartTime, fileValidation.sizeMB);

    // Remove from active transfers
    activeTransfers.delete(filePath);

    // Memory cleanup
    CleanupManager.runGarbageCollection(logToFileAndUI);
  } catch (error) {
    logToFileAndUI(`Error sending document: ${error.message}`, true);
    console.error("Error sending document:", error);

    await handleTransferError(error, filePath, chatId, attemptCount);
  } finally {
    isProcessingFile = false;
    CleanupManager.runGarbageCollection(() => { });
  }
}

// Handle message verification and status updates
async function handleMessageVerification(result, fileName, transferId, sendStartTime, fileSizeMB) {
  try {
    // Wait a moment to ensure server has processed the message
    await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.MESSAGE_VERIFICATION_DELAY_MS));

    // Calculate the final statistics for the transfer
    const totalTime = Math.floor((Date.now() - sendStartTime) / 1000);
    const speedMBps = fileSizeMB / (totalTime || 1);
    const finalSpeed = speedMBps.toFixed(2);

    // Try to get message status from store
    let status = 2; // Default to delivered to server
    try {
      if (store && store.messages) {
        const jid = result.key.remoteJid;
        const chat = store.messages[jid];
        if (chat) {
          const msg = chat.get(result.key.id);
          if (msg) {
            status = msg.status || 2;
            logToFileAndUI(`✓✓ Message delivery status from store: ${status}`);
          }
        }
      }
    } catch (innerError) {
      logToFileAndUI(`Message sent successfully, cannot verify delivery status: ${innerError.message}`);
    }

    // Send confirmation to UI
    if (mainWindow) {
      mainWindow.webContents.send(IPC_EVENTS.FILE_SENT_CONFIRMED, {
        file: fileName,
        messageId: result.key.id,
        status: status,
        transferId,
        elapsed: totalTime,
        speed: finalSpeed,
      });
    }

    // Set up listener for future status updates
    const statusListener = sock.ev.on("messages.update", (updates) => {
      for (const update of updates) {
        if (update.key.id === result.key.id && update.status) {
          logToFileAndUI(`Message status updated: ${update.status}`);
        }
      }
    });

    // Remove listener after timeout to avoid memory leaks
    setTimeout(() => {
      if (sock && sock.ev) {
        sock.ev.off("messages.update", statusListener);
      }
    }, TIMEOUTS.MESSAGE_STATUS_LISTENER_CLEANUP_MS);

  } catch (verifyErr) {
    logToFileAndUI(`Sent file but couldn't verify delivery status: ${verifyErr.message}`);

    // Still send confirmation since the file was sent
    const totalTime = Math.floor((Date.now() - sendStartTime) / 1000);
    const speedMBps = fileSizeMB / (totalTime || 1);
    const finalSpeed = speedMBps.toFixed(2);

    if (mainWindow) {
      mainWindow.webContents.send(IPC_EVENTS.FILE_SENT_CONFIRMED, {
        file: fileName,
        messageId: result.key.id,
        status: 2,
        transferId: result.transferId || Date.now().toString(),
        elapsed: totalTime,
        speed: finalSpeed,
      });
    }
  }
}

// Handle transfer errors with retry logic
async function handleTransferError(error, filePath, chatId, attemptCount) {
  const fileName = path.basename(filePath);

  // Check if this is a connection error
  const isConnectionError = [
    "Connection closed",
    "Stream ended",
    "not connected",
    "timed out",
    "socket hang up"
  ].some(errorType => error.message.includes(errorType));

  if (isConnectionError) {
    logToFileAndUI("WhatsApp connection was lost. Attempting to reconnect...", true);

    if (attemptCount < maxRetries) {
      const nextAttempt = attemptCount + 1;
      logToFileAndUI(
        `This was attempt ${attemptCount + 1}. Will retry after reconnection (${nextAttempt}/${maxRetries})`
      );

      activeTransfers.set(filePath, {
        chatId,
        attemptCount: nextAttempt,
        fileSize: fs.statSync(filePath).size,
        startTime: Date.now(),
      });

      try {
        if (sock) {
          sock.end();
        }

        setTimeout(() => {
          initWhatsAppClient();
          logToFileAndUI("WhatsApp reinitializing, transfer will resume automatically when connected");
        }, 15000);
      } catch (err) {
        logToFileAndUI(`Error during reconnection: ${err.message}`, true);
      }
    } else {
      logToFileAndUI(`Maximum retry attempts (${maxRetries}) reached for file: ${fileName}`, true);
      activeTransfers.delete(filePath);

      if (mainWindow) {
        mainWindow.webContents.send(IPC_EVENTS.FILE_SEND_FAILED, {
          file: fileName,
          error: error.message,
        });
      }
    }
  } else if (error.message.includes("Too large")) {
    logToFileAndUI(`Error: File is too large for WhatsApp. Maximum size is 2GB.`, true);
    activeTransfers.delete(filePath);

    if (mainWindow) {
      mainWindow.webContents.send(IPC_EVENTS.FILE_SEND_FAILED, {
        file: fileName,
        error: "File exceeds WhatsApp size limit of 2GB",
      });
    }
  } else {
    // Other errors - retry if within limit
    if (attemptCount < maxRetries) {
      const nextAttempt = attemptCount + 1;
      logToFileAndUI(`Will retry (${nextAttempt}/${maxRetries}) in 10 seconds...`);

      setTimeout(() => {
        logToFileAndUI(`Retrying file: ${fileName}`);
        processAndSendFile(filePath, chatId, nextAttempt);
      }, TIMEOUTS.FILE_RETRY_MS);
    } else {
      logToFileAndUI(`Maximum retry attempts (${maxRetries}) reached for file: ${fileName}`, true);
      activeTransfers.delete(filePath);

      if (mainWindow) {
        mainWindow.webContents.send(IPC_EVENTS.FILE_SEND_FAILED, {
          file: fileName,
          error: error.message,
        });
      }
    }
  }
}

// Improved file watching with better error handling using constants
ipcMain.on(IPC_EVENTS.START_WATCHING, (event, { folderPath, chatId }) => {
  if (watcher) {
    watcher.close();
  }

  logToFileAndUI(`Started watching folder: ${folderPath}`);

  watcher = chokidar.watch(folderPath, WHATSAPP_CONFIG.CHOKIDAR_CONFIG);

  watcher.on("add", (filePath) => {
    logToFileAndUI(`New file detected: ${filePath}`);

    // Get file extension
    const fileExt = path.extname(filePath).toLowerCase();
    logToFileAndUI(`File extension: ${fileExt}`);

    // Check if file is supported using FileUtils
    if (FileUtils.isFileSupported(filePath)) {
      logToFileAndUI(
        `File ${path.basename(filePath)} is a supported file type, processing...`
      );

      // Extended wait to ensure file is fully written and not locked
      setTimeout(() => {
        logToFileAndUI(
          `Starting file accessibility check for: ${path.basename(filePath)}`
        );

        if (FileUtils.isFileAccessible(filePath)) {
          logToFileAndUI(
            `File ${path.basename(filePath)} is accessible, starting send process...`
          );
          processAndSendFile(filePath, chatId);
        } else {
          logToFileAndUI(
            `File not accessible yet. Waiting longer...`,
            true
          );

          // Try again after additional delay
          setTimeout(() => {
            logToFileAndUI(
              `Retrying file accessibility check for: ${path.basename(filePath)}`
            );

            if (FileUtils.isFileAccessible(filePath)) {
              logToFileAndUI(
                `File ${path.basename(filePath)} is now accessible, starting send process...`
              );
              processAndSendFile(filePath, chatId);
            } else {
              logToFileAndUI(
                `File still not accessible after retry: ${path.basename(filePath)}`,
                true
              );
            }
          }, TIMEOUTS.FILE_ACCESSIBILITY_CHECK_MS);
        }
      }, TIMEOUTS.FILE_ACCESSIBILITY_CHECK_MS);
    } else {
      logToFileAndUI(
        `File ${path.basename(filePath)} with extension ${fileExt} is not a supported format. Skipping.`
      );
      logToFileAndUI(`Supported formats: videos, images, documents, audio files`);
    }
  });

  watcher.on("error", (error) => {
    logToFileAndUI(`Watcher error: ${error}`, true);
  });
});

// Stop watching folder
ipcMain.on(IPC_EVENTS.STOP_WATCHING, () => {
  if (watcher) {
    watcher.close();
    logToFileAndUI("Stopped watching folder");
  }
});

// Reset auth data to force QR code generation using FileUtils
ipcMain.on(IPC_EVENTS.RESET_AUTH_DATA, () => {
  try {
    logToFileAndUI(
      "Resetting authentication data to force new QR code generation..."
    );

    // Get the correct auth directory path that we're using
    const authDirectory = path.join(app.getPath("userData"), "baileys-auth");

    // Clean up auth data using FileUtils
    FileUtils.removeDirectory(authDirectory);
    FileUtils.ensureDirectoryExists(authDirectory);
    logToFileAndUI("Auth credentials directory reset");

    // Reset reconnect attempts counter
    const reconnectAttemptFile = path.join(userDataPath, "reconnect_attempts");
    FileUtils.removeFile(reconnectAttemptFile);

    // Also clear store file to prevent any cached data issues
    const storeFile = path.join(app.getPath("userData"), "baileys_store.json");
    FileUtils.removeFile(storeFile);
    logToFileAndUI("Store data cleared");

    preventAutoReconnect = false; // Reset connection prevention flag
    logToFileAndUI("Authentication data reset complete, ready for new QR code");
  } catch (err) {
    logToFileAndUI(`Error resetting auth data: ${err.message}`, true);
  }
});

// Log out of WhatsApp using CleanupManager and FileUtils
ipcMain.on(IPC_EVENTS.LOGOUT_WHATSAPP, async () => {
  try {
    logToFileAndUI("Logging out of WhatsApp...");

    // Set this flag to prevent automatic reconnection attempts
    preventAutoReconnect = true;

    if (sock) {
      try {
        // First send explicit logout command to WhatsApp servers
        await sock.logout();
        logToFileAndUI("Logout command sent to WhatsApp server");

        // Properly end the socket using CleanupManager
        const { sock: cleanSock, store: cleanStore } = CleanupManager.cleanupWhatsAppSocket(sock, store, logToFileAndUI);
        sock = cleanSock;
        store = cleanStore;

        logToFileAndUI("Socket connection terminated");
      } catch (err) {
        logToFileAndUI(`Error during WhatsApp logout: ${err.message}`, true);
      }
    }

    // Clean up auth data using CleanupManager and FileUtils
    const authPaths = [
      { path: path.join(app.getPath("userData"), "baileys-auth"), description: "Authentication data" },
      { path: userDataPath, description: "Legacy authentication data" },
      { path: path.join(app.getPath("userData"), "session"), description: "Session data" },
      { path: path.join(app.getPath("userData"), "auth_store"), description: "Auth store data" }
    ];

    CleanupManager.cleanupAuthData(authPaths, logToFileAndUI, FileUtils);

    // Clear store files
    const storeFiles = [
      { path: path.join(app.getPath("userData"), "baileys_store.json"), description: "Store file" }
    ];

    CleanupManager.cleanupFiles(storeFiles, logToFileAndUI, FileUtils);

    // Clean up any active transfers
    if (activeTransfers.size > 0) {
      const count = activeTransfers.size;
      activeTransfers.clear();
      logToFileAndUI(`Canceled ${count} pending transfers`);
    }

    // Run garbage collection
    CleanupManager.runGarbageCollection(logToFileAndUI);

    // Notify renderer about disconnection
    mainWindow.webContents.send(IPC_EVENTS.WHATSAPP_DISCONNECTED);
    logToFileAndUI("Logged out of WhatsApp");
  } catch (err) {
    logToFileAndUI(`Error during logout process: ${err.message}`, true);
  }
});

// Check WhatsApp client connection status
ipcMain.on(IPC_EVENTS.CHECK_CONNECTION, async () => {
  try {
    if (!sock || !sock.user) {
      logToFileAndUI("WhatsApp client is not connected");
      mainWindow.webContents.send(IPC_EVENTS.WHATSAPP_DISCONNECTED);
      return;
    }

    // In Baileys, if sock.user exists, we're connected
    if (sock.user.id) {
      logToFileAndUI(`WhatsApp connected as: ${sock.user.id}`);
      mainWindow.webContents.send(IPC_EVENTS.WHATSAPP_READY);
    } else {
      mainWindow.webContents.send(IPC_EVENTS.WHATSAPP_DISCONNECTED);
    }
  } catch (err) {
    logToFileAndUI(`Error checking connection: ${err.message}`, true);
    mainWindow.webContents.send(IPC_EVENTS.WHATSAPP_DISCONNECTED);

    // Try to reconnect
    setTimeout(() => {
      initWhatsAppClient();
    }, TIMEOUTS.CONNECTION_RETRY_MS);
  }
});

// Manually retry sending a file
ipcMain.on(IPC_EVENTS.RETRY_FILE, async (event, { filePath, chatId }) => {
  logToFileAndUI(`Manually retrying file: ${filePath}`);
  processAndSendFile(filePath, chatId, 0);
});

// Cancel all pending transfers
ipcMain.on(IPC_EVENTS.CANCEL_TRANSFERS, () => {
  const count = activeTransfers.size;
  activeTransfers.clear();
  logToFileAndUI(`Canceled ${count} pending transfers`);
});

// Set max retries
ipcMain.on(IPC_EVENTS.SET_MAX_RETRIES, (event, count) => {
  maxRetries = count;
  logToFileAndUI(`Maximum retry attempts set to: ${maxRetries}`);
});

// IPC handler for playing sounds
ipcMain.on(IPC_EVENTS.PLAY_SOUND, (event, soundName) => {
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
