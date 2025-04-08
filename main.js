// main.js - Electron main process
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const chokidar = require('chokidar');
const fs = require('fs');
const { execSync } = require('child_process');

let mainWindow;
let client;
let watcher;
let caption = '';

let shutdownAfterSend = false;

// Ensure the user data directory exists
const userDataPath = path.join(app.getPath('userData'), 'whatsapp-auth');
if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 700,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
        icon: path.join(__dirname, 'assets/icon.png')
    });

    mainWindow.loadFile('index.html');

    // Open DevTools in development
    // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    // Initialize WhatsApp client on app start
    initWhatsAppClient();
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

// Force shutdown computer function (with elevated privileges)
function forceShutdown() {
    try {
        if (process.platform === 'win32') {
            mainWindow.webContents.send('log', 'Executing Windows shutdown command...');
            execSync('shutdown /s /f /t 10');
        } else if (process.platform === 'darwin') { // macOS
            mainWindow.webContents.send('log', 'Executing macOS shutdown command...');
            execSync('osascript -e "tell app \\"System Events\\" to shut down"');
        } else if (process.platform === 'linux') {
            mainWindow.webContents.send('log', 'Executing Linux shutdown command...');
            execSync('systemctl poweroff');
        } else {
            throw new Error('Unsupported platform for shutdown');
        }
        mainWindow.webContents.send('log', 'Shutdown command executed successfully');
        return true;
    } catch (error) {
        mainWindow.webContents.send('error', `Shutdown failed: ${error.message}`);
        console.error('Shutdown error:', error);
        return false;
    }
}

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

// Initialize WhatsApp client
function initWhatsAppClient() {
    // Create new client with LocalAuth
    client = new Client({
        authStrategy: new LocalAuth({
            dataPath: userDataPath
        }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-extensions',
                '--disable-gpu'
            ]
        }
    });

    client.on('qr', (qr) => {
        mainWindow.webContents.send('whatsapp-qr', qr);
        mainWindow.webContents.send('whatsapp-loading', false);
    });

    client.on('ready', async () => {
        mainWindow.webContents.send('whatsapp-ready');
        mainWindow.webContents.send('whatsapp-loading', false);

        try {
            const chats = await client.getChats();
            const chatList = chats.map(chat => ({
                id: chat.id._serialized,
                name: chat.name || chat.id._serialized,
                isGroup: chat.isGroup
            }));

            mainWindow.webContents.send('whatsapp-chats', chatList);
        } catch (err) {
            console.error('Error fetching chats:', err);
            mainWindow.webContents.send('error', 'Failed to fetch WhatsApp chats');
        }
    });

    client.on('authenticated', () => {
        mainWindow.webContents.send('whatsapp-authenticated');
        mainWindow.webContents.send('whatsapp-loading', false);
        mainWindow.webContents.send('log', 'WhatsApp authenticated successfully');
    });

    client.on('auth_failure', () => {
        mainWindow.webContents.send('whatsapp-auth-failure');
        mainWindow.webContents.send('whatsapp-loading', false);
        mainWindow.webContents.send('log', 'WhatsApp authentication failed');
    });

    client.on('disconnected', () => {
        mainWindow.webContents.send('whatsapp-disconnected');
        mainWindow.webContents.send('whatsapp-loading', false);
        mainWindow.webContents.send('log', 'WhatsApp disconnected');
    });

    client.initialize().catch(err => {
        console.error('WhatsApp initialization error:', err);
        mainWindow.webContents.send('error', `WhatsApp initialization error: ${err.message}`);
        mainWindow.webContents.send('whatsapp-loading', false);
    });
}

// Manual WhatsApp initialization request
ipcMain.on('init-whatsapp', async (event) => {
    mainWindow.webContents.send('whatsapp-loading', true);
    mainWindow.webContents.send('log', 'Initializing WhatsApp client...');

    // Destroy previous client if exists
    if (client) {
        try {
            await client.destroy();
        } catch (err) {
            console.log('Error destroying client:', err);
        }
    }

    // Initialize a new client
    initWhatsAppClient();
});

ipcMain.on('update-caption', async (event, value) => { 
    caption = value;
    mainWindow.webContents.send('log', `Caption updated to: ${caption}`);
});

ipcMain.on('toggle-shutdown', (event, value) => {
    shutdownAfterSend = value;
    mainWindow.webContents.send('log', `Shutdown after send set to: ${shutdownAfterSend}`);
});
// Start watching folder
ipcMain.on('start-watching', (event, { folderPath, chatId}) => {
    if (watcher) {
        watcher.close();
    }

    mainWindow.webContents.send('log', `Started watching folder: ${folderPath}`);

    watcher = chokidar.watch(folderPath, {
        persistent: true,
        ignoreInitial: true
    });

    watcher.on('add', (filePath) => {
        mainWindow.webContents.send('log', `New file detected: ${filePath}`);

        // Check if the new file is a video
        if (/\.(mp4|mov|avi|mkv)$/i.test(path.extname(filePath))) {
            // Wait a few seconds to ensure the file is completely written
            setTimeout(async () => {
                try {
                    const fileData = fs.readFileSync(filePath, { encoding: 'base64' });

                    // Determine the MIME type based on the file extension
                    let mimeType = 'video/mp4';
                    const ext = path.extname(filePath).toLowerCase();
                    if (ext === '.mov') mimeType = 'video/quicktime';
                    else if (ext === '.avi') mimeType = 'video/x-msvideo';
                    else if (ext === '.mkv') mimeType = 'video/x-matroska';

                    const media = new MessageMedia(mimeType, fileData, path.basename(filePath));

                    mainWindow.webContents.send('log', `Sending file as document to ${chatId}`);

                    // Use the provided caption or empty string
                    const messageCaption = caption;

                    await client.sendMessage(chatId, media, {
                        sendMediaAsDocument: true,
                        caption: messageCaption
                    });

                    mainWindow.webContents.send('log', 'Shutdown after send: ' + shutdownAfterSend);
                    mainWindow.webContents.send('log', 'Document sent successfully!');

                    // Shutdown PC if requested
                    if (shutdownAfterSend) {
                        mainWindow.webContents.send('log', 'Preparing to shut down system...');

                        // Add a small delay before shutdown to ensure logs are visible
                        setTimeout(() => {
                            forceShutdown();
                        }, 5000);
                    }
                } catch (error) {
                    mainWindow.webContents.send('error', `Error sending document: ${error.message}`);
                    console.error('Error sending document:', error);
                }
            }, 3000); // Delay to ensure file is fully written
        }
    });

    watcher.on('error', (error) => {
        mainWindow.webContents.send('error', `Watcher error: ${error}`);
    });
});

// Stop watching folder
ipcMain.on('stop-watching', () => {
    if (watcher) {
        watcher.close();
        mainWindow.webContents.send('log', 'Stopped watching folder');
    }
});

// Log out of WhatsApp
ipcMain.on('logout-whatsapp', async () => {
    if (client) {
        try {
            mainWindow.webContents.send('log', 'Logging out of WhatsApp...');
            await client.logout();
            await client.destroy();
            mainWindow.webContents.send('log', 'Logged out of WhatsApp');
            mainWindow.webContents.send('whatsapp-disconnected');

            // Clear auth data
            const authFolder = path.join(userDataPath, '.wwebjs_auth');
            if (fs.existsSync(authFolder)) {
                fs.rmSync(authFolder, { recursive: true, force: true });
                mainWindow.webContents.send('log', 'Authentication data cleared');
            }

            // Reinitialize client
            setTimeout(() => {
                initWhatsAppClient();
            }, 1000);
        } catch (err) {
            mainWindow.webContents.send('error', `Error logging out: ${err.message}`);
        }
    }
});