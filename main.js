const { Client, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');

// Update these with your actual folder path and group ID:
const folderToWatch = '/Users/macky/Desktop/output'; // Folder exported from Premiere Pro
const groupId = '918655214798@c.us'; // Replace with your target WhatsApp group ID

// Initialize WhatsApp client
const client = new Client();

client.on('qr', (qr) => {
    // Display the QR code in terminal for scanning with your WhatsApp mobile app
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('WhatsApp client is ready!');

    // Start watching the folder for new video files
    const watcher = chokidar.watch(folderToWatch, { persistent: true });


    watcher.on('add', (filePath) => {
        console.log(`New file detected: ${filePath}`);

        // Check if the new file is a video (update or add extensions as needed)
        if (/\.(mp4|mov|avi|mkv)$/i.test(path.extname(filePath))) {
            // Optionally wait a few seconds to ensure the file is completely written
            setTimeout(async () => {
                try {
                    // Read the file as base64 data
                    const fileData = fs.readFileSync(filePath, { encoding: 'base64' });

                    // Determine the MIME type based on the file extension (default to mp4)
                    let mimeType = 'video/mp4';
                    const ext = path.extname(filePath).toLowerCase();
                    if (ext === '.mov') mimeType = 'video/quicktime';
                    else if (ext === '.avi') mimeType = 'video/x-msvideo';
                    else if (ext === '.mkv') mimeType = 'video/x-matroska';

                    // Create a MessageMedia object, including the filename
                    const media = new MessageMedia(mimeType, fileData, path.basename(filePath));

                    console.log(`Sending file as a document to WhatsApp group ${groupId}`);
                    // The option sendMediaAsDocument: true will send the video as a document (not as inline media)
                    await client.sendMessage(groupId, media, {
                        sendMediaAsDocument: true,
                        caption: 'New video exported as document!'
                    });
                    console.log('Document sent successfully!');
                } catch (error) {
                    console.error('Error sending document:', error);
                }
            }, 3000); // Delay in milliseconds; adjust as needed
        }
    });

    console.log(`Watching folder: ${folderToWatch}`);
});


client.initialize();
