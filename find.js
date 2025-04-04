// main.js
// Main file that initializes the WhatsApp client and calls the getWhatsAppIds function

const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const getWhatsAppIds = require('./getWhatsAppId');

// Initialize WhatsApp client
const client = new Client();

client.on('qr', qr => {
    // Generate and display QR Code in terminal
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('WhatsApp client is ready!');
    try {
        const chats = await client.getChats();
        chats.forEach(chat => {
            console.log(`Chat Name: ${chat.name}`);
            console.log(`WhatsApp ID: ${chat.id._serialized}`);
            console.log('--------------------------');
        });
    } catch (error) {
        console.error('Error fetching chats:', error);
    }


});

client.initialize();
