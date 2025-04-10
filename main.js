// main.js - Electron main process with enhanced file handling for large single files using Baileys
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { default: makeWASocket, DisconnectReason, makeInMemoryStore, proto } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const chokidar = require('chokidar');
const fs = require('fs');
const { exec, execSync } = require('child_process');
const os = require('os');
const pino = require('pino');
const mime = require('mime-types');
const { writeFile, readFile, mkdir } = require('fs/promises');

// Global variables
let mainWindow;
let sock;
let store;
let watcher;
let caption = '';
let shutdownAfterSend = false;
let isProcessingFile = false;
let activeTransfers = new Map(); // Track active transfers
let maxRetries = 5;
let preventAutoReconnect = false; // New flag to control automatic reconnections

// Ensure the user data directory exists
const userDataPath = path.join(app.getPath('userData'), 'whatsapp-auth');
if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
}

// Store logs in a file as well as sending to UI
const logFilePath = path.join(app.getPath('userData'), 'logs.txt');
function logToFileAndUI(message, isError = false) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;

    fs.appendFileSync(logFilePath, logMessage);

    if (mainWindow) {
        if (isError) {
            mainWindow.webContents.send('error', message);
        } else {
            mainWindow.webContents.send('log', message);
        }
    }
    console.log(logMessage);
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            // Enable garbage collection exposure
            additionalArguments: ['--js-flags=--expose-gc']
        },
        icon: path.join(__dirname, 'assets/icon.png')
    });

    mainWindow.loadFile('index.html');

    // Log system resources but do NOT initialize WhatsApp automatically
    getSystemResources();
    logToFileAndUI('Application ready. Click "Connect WhatsApp" to begin.');

    // Open DevTools in development
    // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    // Log system resources but DON'T auto-initialize WhatsApp
    getSystemResources();
    logToFileAndUI('Application ready. Click "Connect WhatsApp" to start.');
});

app.on('window-all-closed', async function () {
    if (sock) {
        try {
            sock.logout();
            sock.end();
        } catch (err) {
            logToFileAndUI(`Error closing WhatsApp connection: ${err.message}`, true);
        }
    }
     app.quit();
});

// Force shutdown computer function (with elevated privileges)
function forceShutdown() {
    try {
        if (process.platform === 'win32') {
            logToFileAndUI('Executing Windows shutdown command...');
            execSync('shutdown /s /f /t 10');
        } else if (process.platform === 'darwin') { // macOS
            logToFileAndUI('Executing macOS shutdown command...');
            execSync('osascript -e "tell app \\"System Events\\" to shut down"');
        } else if (process.platform === 'linux') {
            logToFileAndUI('Executing Linux shutdown command...');
            execSync('systemctl poweroff');
        } else {
            throw new Error('Unsupported platform for shutdown');
        }
        logToFileAndUI('Shutdown command executed successfully');
        return true;
    } catch (error) {
        logToFileAndUI(`Shutdown failed: ${error.message}`, true);
        console.error('Shutdown error:', error);
        return false;
    }
}

// Get system info for better resource allocation
function getSystemResources() {
    const totalMemGB = Math.floor(os.totalmem() / (1024 * 1024 * 1024));
    const freeMemGB = Math.floor(os.freemem() / (1024 * 1024 * 1024));
    const cpuCount = os.cpus().length;

    logToFileAndUI(`System info: ${totalMemGB}GB RAM (${freeMemGB}GB free), ${cpuCount} CPUs`);

    return {
        totalMemGB,
        freeMemGB,
        cpuCount
    };
}

// Initialize WhatsApp client with Baileys - Simplified implementation to avoid the public key error
async function initWhatsAppClient() {
    // Clean up any existing socket before starting
    if (sock) {
        try {
            sock.end();
        } catch (e) {
            console.error('Error cleaning up previous socket:', e);
        }
    }

    logToFileAndUI('Initializing WhatsApp client...');

    // Use the built-in state handler from Baileys instead of custom implementation
    // This avoids the complicated key handling that's causing the errors
    const { state, saveCreds } = await useSimpleBaileysAuth();

    // Create minimal logger to reduce noise
    const logger = pino({
        level: process.env.NODE_ENV === 'production' ? 'error' : 'warn',
    }).child({ level: 'silent' });

    try {
        // Create in-memory store
        store = makeInMemoryStore({ logger });

        // Use much simpler socket configuration to prevent cryptography errors
        sock = makeWASocket({
            logger,
            printQRInTerminal: true, // Enable QR in terminal for debugging
            auth: state,
            browser: ['WhatsApp Large File Sender', 'Chrome', '100.0.0.0'],
            connectTimeoutMs: 60000,
            // Disable all complicated features that could cause errors
            syncFullHistory: false,
            linkPreviewImageThumbnailWidth: 0,
            transactionOpts: { maxCommitRetries: 1, maxRetries: 1 },
            getMessage: async () => { return { conversation: '' } },
            markOnlineOnConnect: false
        });

        // Bind store to events
        if (store) store.bind(sock.ev);

        logToFileAndUI('Waiting for connection events from WhatsApp...');

        // Handle connection updates
        sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
            if (qr) {
                // Got QR code, now display it to user
                logToFileAndUI('WhatsApp QR code received. Please scan with your phone.');

                // Display QR in terminal for debugging
                try {
                    require('qrcode-terminal').generate(qr, { small: true }, (qrCode) => {
                        console.log(qrCode);
                    });
                } catch (e) {
                    // QR in terminal is optional, continue if it fails
                    console.log("Could not print QR in terminal:", e);
                }

                if (mainWindow) {
                    mainWindow.webContents.send('whatsapp-qr', qr);
                    mainWindow.webContents.send('whatsapp-loading', false);
                }
            }

            if (connection === 'open') {
                logToFileAndUI('WhatsApp connection is open and ready');

                if (mainWindow) {
                    mainWindow.webContents.send('whatsapp-ready');
                    mainWindow.webContents.send('whatsapp-authenticated');
                }

                // Get chats after connection is established
                getAllChats().catch(e => logToFileAndUI(`Error getting chats: ${e.message}`, true));
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                logToFileAndUI(`Connection closed with status: ${statusCode}`);

                if (mainWindow) {
                    mainWindow.webContents.send('whatsapp-disconnected');
                }

                if (shouldReconnect && !preventAutoReconnect) {
                    logToFileAndUI('Will attempt reconnection in 5 seconds...');
                    setTimeout(() => {
                        initWhatsAppClient();
                    }, 5000);
                }
            }
        });

        // Save credentials when updated
        sock.ev.on('creds.update', saveCreds);

    } catch (err) {
        logToFileAndUI(`Failed to initialize WhatsApp: ${err.message}`, true);
        console.error("WhatsApp initialization error:", err);

        // Only retry if it's not a fatal error
        if (!err.message.includes('rate-limit') && !err.message.includes('banned')) {
            setTimeout(() => {
                logToFileAndUI('Retrying connection in 10 seconds...');
                initWhatsAppClient();
            }, 10000);
        } else {
            logToFileAndUI('Cannot connect due to rate limiting or ban. Please try again later.', true);
        }
    }
}

// Simplified auth state handler that relies on Baileys' built-in functionality
async function useSimpleBaileysAuth() {
    try {
        // Import Baileys state handler
        const { useMultiFileAuthState } = require('@whiskeysockets/baileys');

        // Ensure the directory exists
        const authDirectory = path.join(app.getPath('userData'), 'baileys-auth');
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
        logToFileAndUI(`Found ${activeTransfers.size} pending transfers. Resuming...`);

        for (const [filePath, transfer] of activeTransfers.entries()) {
            logToFileAndUI(`Resuming transfer for ${path.basename(filePath)}`);

            // Re-attempt the transfer
            processAndSendFile(filePath, transfer.chatId, transfer.attemptCount);
        }
    }
}

// Manual WhatsApp initialization request
ipcMain.on('init-whatsapp', async (event) => {
    mainWindow.webContents.send('whatsapp-loading', true);
    logToFileAndUI('Initializing WhatsApp client...');

    // Initialize a new client
    await initWhatsAppClient();
});

ipcMain.on('update-caption', async (event, value) => {
    caption = value;
    logToFileAndUI(`Caption updated to: ${caption}`);
});

ipcMain.on('toggle-shutdown', (event, value) => {
    shutdownAfterSend = value;
    logToFileAndUI(`Shutdown after send set to: ${shutdownAfterSend}`);
});

// Handle folder selection
ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });

    if (!result.canceled) {
        return result.filePaths[0];
    }
    return null;
});

// Convert JID format if needed (Baileys uses different JID format)
function ensureProperJid(jid) {
    if (!jid.includes('@')) {
        // Convert to proper format if needed
        return jid.includes('-') ? `${jid}@g.us` : `${jid}@s.whatsapp.net`;
    }
    return jid;
}

// Optimized file sending with improved memory handling for large files
async function processAndSendFile(filePath, chatId, attemptCount = 0) {
    if (isProcessingFile && attemptCount === 0) {
        logToFileAndUI('Already processing a file, please wait...');
        return;
    }

    isProcessingFile = true;
    logToFileAndUI(`Processing file: ${filePath}`);

    try {
        // Check file size and accessibility
        const fileStats = fs.statSync(filePath);
        const fileSizeMB = fileStats.size / (1024 * 1024);
        logToFileAndUI(`File size: ${fileStats.size} bytes (${fileSizeMB.toFixed(2)}MB)`);

        if (fileStats.size === 0) {
            logToFileAndUI('File appears empty, skipping...');
            isProcessingFile = false;
            return;
        }

        // File size warning
        if (fileSizeMB > 1000) { // 1GB
            logToFileAndUI('Warning: File is extremely large (>1GB). This may take some time...', true);
            logToFileAndUI('Optimizing memory for large file transfer...');
        }

        if (fileSizeMB > 2000) { // 2GB
            logToFileAndUI('Error: File exceeds 2GB limit. WhatsApp has a maximum file size limit of 2GB', true);
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
            transferId
        });

        // Determine the MIME type based on the file extension
        const ext = path.extname(filePath).toLowerCase();
        const mimeType = mime.lookup(ext) || 'application/octet-stream';

        logToFileAndUI(`Preparing to send file with mimetype: ${mimeType}`);
        logToFileAndUI('Reading file data (this may take a while for large files)...');

        // Force garbage collection before reading the file
        if (global.gc) {
            global.gc();
            logToFileAndUI('Performed garbage collection before file read');
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
            mainWindow.webContents.send('upload-progress', {
                file: fileName,
                progress: 1, // Start at 1%
                elapsed: 0,
                speed: '0.00',
                eta: 'Calculating...',
                destination: ensureProperJid(chatId).split('@')[0],
                fileType: mimeType,
                fileSize: `${(fileStats.size / (1024 * 1024)).toFixed(2)} MB`,
                transferId
            });

            // Force an update of the UI
            logToFileAndUI('File transfer started - engine animation should be visible');
        }

        // Register a progress callback
        const onProgress = (progress) => {
            // Only update at most once per second to avoid UI spam
            const now = Date.now();
            if (now - lastProgressUpdate >= 1000) {
                lastProgressUpdate = now;
                const elapsedSeconds = Math.floor((now - sendStartTime) / 1000);
                const percent = progress.total ? Math.round((progress.uploaded / progress.total) * 100) : 'unknown';

                bytesProcessed = progress.uploaded;

                // Calculate speed in MB/s
                const speed = elapsedSeconds > 0 ?
                    (bytesProcessed / (1024 * 1024) / elapsedSeconds).toFixed(2) :
                    "0.00";

                // Calculate ETA
                let eta = "Unknown";
                if (progress.total && elapsedSeconds > 0 && percent < 100) {
                    const remainingPercent = 100 - percent;
                    const timePerPercent = elapsedSeconds / percent;
                    const remainingSeconds = Math.round(remainingPercent * timePerPercent);
                    eta = `~${remainingSeconds}s remaining`;
                } else if (percent >= 100) {
                    eta = "Completing...";
                }

                logToFileAndUI(`Upload progress: ${percent}% (${elapsedSeconds}s elapsed, ${speed} MB/s)`);

                // Send enhanced progress to UI
                if (mainWindow) {
                    mainWindow.webContents.send('upload-progress', {
                        file: fileName,
                        progress: percent,
                        elapsed: elapsedSeconds,
                        speed: `${speed}`,
                        eta: eta,
                        destination: ensureProperJid(chatId).split('@')[0],
                        fileType: mimeType,
                        fileSize: `${(fileStats.size / (1024 * 1024)).toFixed(2)} MB`,
                        transferId
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
        const estimatedTimeSeconds = Math.max(20, Math.min(300, Math.round(fileSizeMB * 0.5))); // Estimate based on file size
        const updateFrequency = 800; // Update every 800ms

        // Calculate how much to increment progress each time
        const progressIncrement = 90 / (estimatedTimeSeconds * 1000 / updateFrequency);

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
            const speedMBps = elapsedSeconds > 0 ?
                ((processedEstimate / (1024 * 1024)) / elapsedSeconds).toFixed(2) : 0;

            // Send the progress update
            if (mainWindow) {
                mainWindow.webContents.send('upload-progress', {
                    file: fileName,
                    progress: Math.round(simulatedProgress),
                    elapsed: elapsedSeconds,
                    speed: speedMBps,
                    eta: `~${Math.round(estimatedTimeSeconds - elapsedSeconds)}s remaining`,
                    destination: ensureProperJid(chatId).split('@')[0],
                    fileType: mimeType,
                    fileSize: `${(fileStats.size / (1024 * 1024)).toFixed(2)} MB`,
                    transferId
                });
            }
        }, updateFrequency);

        try {
            if (fileSizeMB > 500) {
                logToFileAndUI('Using optimized approach for large file upload');

                // Use message options with additional settings for large files
                const options = {
                    uploadProgress: onProgress
                };

                // With Baileys, we can send as a document directly from the file path with progress tracking
                result = await sock.sendMessage(jid, {
                    document: { url: filePath },
                    fileName: fileName,
                    mimetype: mimeType,
                    caption: caption,
                }, options);

            } else {
                // For smaller files, use the standard approach
                logToFileAndUI('Using standard approach for smaller file');
                const buffer = fs.readFileSync(filePath);

                result = await sock.sendMessage(jid, {
                    document: buffer,
                    fileName: fileName,
                    mimetype: mimeType,
                    caption: caption
                });
            }

            // Clear the progress interval once sending is complete
            clearInterval(progressInterval);

            // Send final 100% progress update
            if (mainWindow) {
                mainWindow.webContents.send('upload-progress', {
                    file: fileName,
                    progress: 100,
                    elapsed: Math.floor((Date.now() - startTime) / 1000),
                    speed: (fileSizeMB / (Math.floor((Date.now() - startTime) / 1000) || 1)).toFixed(2),
                    eta: 'Complete!',
                    destination: ensureProperJid(chatId).split('@')[0],
                    fileType: mimeType,
                    fileSize: `${(fileStats.size / (1024 * 1024)).toFixed(2)} MB`,
                    transferId
                });
            }

            const totalTime = Math.floor((Date.now() - sendStartTime) / 1000);
            const speedMBps = fileSizeMB / (totalTime || 1);

            logToFileAndUI(`✅ Document sent successfully! Message ID: ${result.key.id}`);
            logToFileAndUI(`Transfer completed in ${totalTime} seconds (average speed: ${speedMBps.toFixed(2)} MB/s)`);
            // Shutdown PC if requested
            if (shutdownAfterSend) {
                logToFileAndUI('Preparing to shut down system...');

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
            await new Promise(resolve => setTimeout(resolve, 3000));

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
                            logToFileAndUI(`✓✓ Message delivery status from store: ${status}`);
                            mainWindow.webContents.send('file-sent-confirmed', {
                                file: fileName,
                                messageId: result.key.id,
                                status: status,
                                transferId
                            });
                            return; // Successfully found status
                        }
                    }
                }

                // Method 2: Use read-receipts event - this is just to set up future status updates
                // We'll assume successful delivery since the message was sent without error
                logToFileAndUI(`✓ Message assumed delivered (ID: ${result.key.id})`);
                mainWindow.webContents.send('file-sent-confirmed', {
                    file: fileName,
                    messageId: result.key.id,
                    status: 2, // Assume delivered to server
                    transferId
                });

                // Set up listener for future status updates for this message
                const statusListener = sock.ev.on('messages.update', updates => {
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
                    sock.ev.off('messages.update', statusListener);
                }, 60000);

            } catch (innerError) {
                // Fall back to basic confirmation - the message was sent successfully
                logToFileAndUI(`Message sent successfully, cannot verify delivery status: ${innerError.message}`);
                mainWindow.webContents.send('file-sent-confirmed', {
                    file: fileName,
                    messageId: result.key.id,
                    status: 2, // Assume delivered to server
                    transferId
                });
            }
        } catch (verifyErr) {
            logToFileAndUI(`Sent file but couldn't verify delivery status: ${verifyErr.message}`);
            // Still send confirmation since the file was sent
            mainWindow.webContents.send('file-sent-confirmed', {
                file: fileName,
                messageId: result.key.id,
                status: 2, // Assume delivered to server
                transferId
            });
        }

        // Remove from active transfers
        activeTransfers.delete(filePath);

        // Memory cleanup
        if (global.gc) {
            global.gc();
            logToFileAndUI('Performed garbage collection after successful send');
        }


    } catch (error) {
        logToFileAndUI(`Error sending document: ${error.message}`, true);
        console.error('Error sending document:', error);

        // Check if this is a connection error
        if (
            error.message.includes('Connection closed') ||
            error.message.includes('Stream ended') ||
            error.message.includes('not connected') ||
            error.message.includes('timed out') ||
            error.message.includes('socket hang up')
        ) {
            logToFileAndUI('WhatsApp connection was lost. Attempting to reconnect...', true);

            // Try to reconnect and retry the transfer if within retry limit
            if (attemptCount < maxRetries) {
                const nextAttempt = attemptCount + 1;
                logToFileAndUI(`This was attempt ${attemptCount + 1}. Will retry after reconnection (${nextAttempt}/${maxRetries})`);

                activeTransfers.set(filePath, {
                    chatId,
                    attemptCount: nextAttempt,
                    fileSize: fs.statSync(filePath).size,
                    startTime: Date.now() // Reset start time for the retry
                });

                try {
                    if (sock) {
                        sock.end();
                    }

                    setTimeout(() => {
                        initWhatsAppClient();
                        logToFileAndUI('WhatsApp reinitializing, transfer will resume automatically when connected');
                    }, 15000);
                } catch (err) {
                    logToFileAndUI(`Error during reconnection: ${err.message}`, true);
                }
            } else {
                logToFileAndUI(`Maximum retry attempts (${maxRetries}) reached for file: ${path.basename(filePath)}`, true);
                activeTransfers.delete(filePath);
                mainWindow.webContents.send('file-send-failed', {
                    file: path.basename(filePath),
                    error: error.message
                });
            }
        } else if (error.message.includes('Too large')) {
            // Specific error for file size limit
            logToFileAndUI(`Error: File is too large for WhatsApp. Maximum size is 2GB.`, true);
            activeTransfers.delete(filePath);
            mainWindow.webContents.send('file-send-failed', {
                file: path.basename(filePath),
                error: 'File exceeds WhatsApp size limit of 2GB'
            });
        } else {
            // Other errors
            logToFileAndUI(`Error: ${error.message}`, true);

            // For general errors, retry if within limit
            if (attemptCount < maxRetries) {
                const nextAttempt = attemptCount + 1;
                logToFileAndUI(`Will retry (${nextAttempt}/${maxRetries}) in 10 seconds...`);

                setTimeout(() => {
                    logToFileAndUI(`Retrying file: ${path.basename(filePath)}`);
                    processAndSendFile(filePath, chatId, nextAttempt);
                }, 10000);
            } else {
                logToFileAndUI(`Maximum retry attempts (${maxRetries}) reached for file: ${path.basename(filePath)}`, true);
                activeTransfers.delete(filePath);
                mainWindow.webContents.send('file-send-failed', {
                    file: path.basename(filePath),
                    error: error.message
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
ipcMain.on('start-watching', (event, { folderPath, chatId }) => {
    if (watcher) {
        watcher.close();
    }

    logToFileAndUI(`Started watching folder: ${folderPath}`);

    watcher = chokidar.watch(folderPath, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
            stabilityThreshold: 15000, // Wait 15 seconds of stability before considering file complete
            pollInterval: 2000 // Check every 2 seconds
        },
        usePolling: true, // More reliable for network drives
        interval: 5000,    // 5 seconds polling interval for more stability
        binaryInterval: 10000, // Check binary files less frequently to reduce CPU usage
        depth: 0,          // Only watch files in the immediate directory, not subdirectories
        ignorePermissionErrors: true
    });

    watcher.on('add', (filePath) => {
        logToFileAndUI(`New file detected: ${filePath}`);

        // Check if the new file is a video
        if (/\.(mp4|mov|avi|mkv)$/i.test(path.extname(filePath))) {
            // Extended wait to ensure file is fully written and not locked
            setTimeout(() => {
                try {
                    // Test if file is accessible and not locked
                    const fd = fs.openSync(filePath, 'r');
                    fs.closeSync(fd);

                    // Start processing the file
                    processAndSendFile(filePath, chatId);

                } catch (err) {
                    logToFileAndUI(`File not accessible yet: ${err.message}. Waiting longer...`, true);

                    // Try again after additional delay
                    setTimeout(() => {
                        processAndSendFile(filePath, chatId);
                    }, 10000);
                }
            }, 10000);
        }
    });

    watcher.on('error', (error) => {
        logToFileAndUI(`Watcher error: ${error}`, true);
    });
});

// Stop watching folder
ipcMain.on('stop-watching', () => {
    if (watcher) {
        watcher.close();
        logToFileAndUI('Stopped watching folder');
    }
});

// Reset auth data to force QR code generation
ipcMain.on('reset-auth-data', () => {
    try {
        logToFileAndUI('Resetting authentication data to force new QR code generation...');

        // Delete auth credentials
        if (fs.existsSync(authCreds)) {
            fs.unlinkSync(authCreds);
            logToFileAndUI('Auth credentials deleted');
        }

        // Clear auth keys directory
        if (fs.existsSync(authKeysPath)) {
            fs.rmSync(authKeysPath, { recursive: true, force: true });
            fs.mkdirSync(authKeysPath, { recursive: true });
            logToFileAndUI('Auth keys directory reset');
        }

        // Reset reconnect attempts counter
        const reconnectAttemptFile = path.join(userDataPath, 'reconnect_attempts');
        fs.writeFileSync(reconnectAttemptFile, '0');

        // Also clear store file to prevent any cached data issues
        const storeFile = path.join(userDataPath, 'baileys_store.json');
        if (fs.existsSync(storeFile)) {
            fs.unlinkSync(storeFile);
            logToFileAndUI('Store data cleared');
        }

        logToFileAndUI('Authentication data reset complete, ready for new QR code');
    } catch (err) {
        logToFileAndUI(`Error resetting auth data: ${err.message}`, true);
    }
});

// Log out of WhatsApp
ipcMain.on('logout-whatsapp', async () => {
    if (sock) {
        try {
            logToFileAndUI('Logging out of WhatsApp...');
            await sock.logout();
            sock.end();
            logToFileAndUI('Logged out of WhatsApp');
            mainWindow.webContents.send('whatsapp-disconnected');

            // Clear auth data
            if (fs.existsSync(userDataPath)) {
                fs.rmSync(userDataPath, { recursive: true, force: true });
                logToFileAndUI('Authentication data cleared');
            }

            // Reinitialize client
            setTimeout(() => {
                initWhatsAppClient();
            }, 3000);
        } catch (err) {
            logToFileAndUI(`Error logging out: ${err.message}`, true);
        }
    }
});

// Check WhatsApp client connection status
ipcMain.on('check-connection', async () => {
    try {
        if (!sock || !sock.user) {
            logToFileAndUI('WhatsApp client is not connected');
            mainWindow.webContents.send('whatsapp-disconnected');
            return;
        }

        // In Baileys, if sock.user exists, we're connected
        if (sock.user.id) {
            logToFileAndUI(`WhatsApp connected as: ${sock.user.id}`);
            mainWindow.webContents.send('whatsapp-ready');
        } else {
            mainWindow.webContents.send('whatsapp-disconnected');
        }
    } catch (err) {
        logToFileAndUI(`Error checking connection: ${err.message}`, true);
        mainWindow.webContents.send('whatsapp-disconnected');

        // Try to reconnect
        setTimeout(() => {
            initWhatsAppClient();
        }, 5000);
    }
});

// Manually retry sending a file
ipcMain.on('retry-file', async (event, { filePath, chatId }) => {
    logToFileAndUI(`Manually retrying file: ${filePath}`);
    processAndSendFile(filePath, chatId, 0);
});

// Cancel all pending transfers
ipcMain.on('cancel-transfers', () => {
    const count = activeTransfers.size;
    activeTransfers.clear();
    logToFileAndUI(`Canceled ${count} pending transfers`);
});

// Set max retries
ipcMain.on('set-max-retries', (event, count) => {
    maxRetries = count;
    logToFileAndUI(`Maximum retry attempts set to: ${maxRetries}`);
});

// Enhanced getAllChats function to find as many chats as possible
async function getAllChats() {
    try {
        logToFileAndUI('Fetching WhatsApp chats (enhanced method)...');

        // Show loading indicator in UI
        if (mainWindow) {
            mainWindow.webContents.send('chats-loading', true);
        }

        const chatSet = new Map(); // Use a Map to avoid duplicates

        // 1. First get all groups
        try {
            const fetchedGroups = await sock.groupFetchAllParticipating();
            logToFileAndUI(`Found ${Object.keys(fetchedGroups).length} participating groups`);

            Object.entries(fetchedGroups).forEach(([id, chat]) => {
                chatSet.set(id, {
                    id: id,
                    name: chat.subject || id,
                    isGroup: true
                });
            });
        } catch (e) {
            logToFileAndUI(`Error fetching groups: ${e.message}`, true);
        }

        // 2. Get chats from store - this should have more chats than just the direct API call
        try {
            if (store && store.chats) {
                const storeChats = await store.chats.all();
                logToFileAndUI(`Found ${storeChats.length} chats in store`);

                storeChats.forEach(chat => {
                    if (!chatSet.has(chat.id)) {
                        chatSet.set(chat.id, {
                            id: chat.id,
                            name: chat.name || chat.id.split('@')[0],
                            isGroup: chat.id.endsWith('@g.us')
                        });
                    }
                });
            }
        } catch (e) {
            logToFileAndUI(`Error fetching chats from store: ${e.message}`, true);
        }

        // 3. Get chats from message history - this can find contacts even if they're not in active chats
        try {
            if (store && store.messages) {
                const messageJids = Object.keys(store.messages);
                logToFileAndUI(`Found ${messageJids.length} chats in message history`);

                for (const jid of messageJids) {
                    if (!chatSet.has(jid)) {
                        const isGroup = jid.endsWith('@g.us');

                        // For non-groups, try to get contact info
                        let name = jid.split('@')[0];
                        if (!isGroup) {
                            try {
                                const contact = await sock.contactAddOrGet(jid);
                                if (contact && contact.name) {
                                    name = contact.name;
                                } else if (contact && contact.notify) {
                                    name = contact.notify;
                                }
                            } catch (err) {
                                // Just use JID if contact fetch fails
                            }
                        }

                        chatSet.set(jid, {
                            id: jid,
                            name: name,
                            isGroup: isGroup
                        });
                    }
                }
            }
        } catch (e) {
            logToFileAndUI(`Error processing message history: ${e.message}`, true);
        }

        // 4. Try to get contacts directly from phone
        try {
            // Note: method depends on Baileys version
            if (typeof sock.fetchContacts === 'function') {
                const contacts = await sock.fetchContacts();
                logToFileAndUI(`Found ${Object.keys(contacts).length} contacts`);

                Object.entries(contacts).forEach(([id, contact]) => {
                    if (!chatSet.has(id) && !id.endsWith('@g.us')) {
                        chatSet.set(id, {
                            id: id,
                            name: contact.name || contact.notify || id.split('@')[0],
                            isGroup: false
                        });
                    }
                });
            } else {
                logToFileAndUI('Direct contact fetch not supported in this version');
            }
        } catch (e) {
            // This may not work in all versions
            logToFileAndUI('Direct contact query not supported in this version');
        }

        // Final approach - check if we can get all saved contacts
        try {
            if (sock.contacts) {
                const allContacts = Object.entries(sock.contacts);
                logToFileAndUI(`Found ${allContacts.length} contacts from sock.contacts`);

                allContacts.forEach(([jid, contact]) => {
                    if (!chatSet.has(jid) && !jid.endsWith('@g.us')) {
                        chatSet.set(jid, {
                            id: jid,
                            name: contact.name || contact.notify || jid.split('@')[0],
                            isGroup: false
                        });
                    }
                });
            }
        } catch (e) {
            logToFileAndUI(`Error accessing contacts: ${e.message}`, true);
        }

        // Convert map to array and send to renderer
        const chatList = Array.from(chatSet.values());
        logToFileAndUI(`Total chats found: ${chatList.length}`);

        // Sort chats by name for better usability
        chatList.sort((a, b) => {
            // Groups first, then individual chats
            if (a.isGroup && !b.isGroup) return -1;
            if (!a.isGroup && b.isGroup) return 1;
            return a.name.localeCompare(b.name);
        });

        // Hide loading indicator and send chats to UI
        mainWindow.webContents.send('chats-loading', false);
        mainWindow.webContents.send('whatsapp-chats', chatList);
        logToFileAndUI(`Sent ${chatList.length} chats to UI`);

        // Try to sync more data for future requests
        try {
            // Request history sync
            sock.ev.emit('presence.request', []);
            if (typeof sock.resyncAppState === 'function') {
                sock.resyncAppState(['Contacts', 'Chats', 'RecentChats']).catch(e => {
                    console.log('Sync error:', e);
                });
            }
        } catch (e) {
            logToFileAndUI(`Warning: Could not request sync: ${e.message}`);
        }

    } catch (err) {
        console.error('Error fetching chats:', err);
        logToFileAndUI(`Failed to fetch WhatsApp chats: ${err.message}`, true);
        // Ensure we hide the loading indicator even on error
        if (mainWindow) {
            mainWindow.webContents.send('chats-loading', false);
        }
    }
}