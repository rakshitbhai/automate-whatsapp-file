# 🚀 Chatrik - Your Chat Sidekick

**Chatrik** is a powerful WhatsApp automation tool built with Electron that helps you automatically send files to WhatsApp contacts and groups. Monitor folders, detect new files, and instantly deliver them through WhatsApp Web with a beautiful desktop interface.

*Chatrik – Your Chat Sidekick for seamless WhatsApp automation.*

---

## ✨ Features

- 🖥️ **Desktop Application**: Built with Electron for cross-platform compatibility (Windows, macOS, Linux)
- 📁 **Smart File Monitoring**: Automatically watches folders for new files and sends them instantly
- 📲 **WhatsApp Integration**: Seamlessly connects with WhatsApp Web using Baileys library
- 🎨 **Beautiful UI**: Modern interface with interactive animations and responsive design
- 🔄 **Real-time Sync**: Instant file detection and sending without manual intervention
- 🐱 **Fun Animations**: Includes cat and truck animations for an engaging user experience
- 📊 **File Type Support**: Handles various file formats including videos, documents, and images
- 🔐 **Secure Authentication**: QR code authentication for secure WhatsApp connection

---

## 📂 Project Structure

```
.
├── README.md              # Project documentation
├── main.js               # Electron main process & WhatsApp automation
├── index.html            # Main application UI
├── package.json          # Project metadata and dependencies
├── assets/               # Application icons for different platforms
│   ├── icon.png          # Main application icon
│   ├── icon.ico          # Windows icon
│   └── icon.icns         # macOS icon
├── components/           # UI components
│   ├── cat-animation.html    # Cat animation component
│   ├── power-button.html    # Power button component
│   └── truck-animation.html # Truck animation component
└── styles/               # CSS stylesheets
    ├── styles.css        # Main application styles
    ├── cat.css           # Cat animation styles
    └── truck.css         # Truck animation styles
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn package manager

### 1. Clone the repository

```bash
git clone https://github.com/rakshitbhai/automate-whatsapp-file.git
cd automate-whatsapp-file
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure your settings

The application provides a user-friendly interface to configure:
- Target WhatsApp contacts or groups
- Folder paths to monitor
- File types to watch for
- Sending preferences

### 4. Run the application

#### Development Mode
```bash
npm start
```

#### Build for Production

**Windows:**
```bash
npm run build:win
```

**macOS:**
```bash
npm run build:mac
```

**Linux:**
```bash
npm run build:linux
```

**All platforms:**
```bash
npm run build
```

🔍 On first run, you'll need to scan a QR code with your WhatsApp mobile app to authenticate the connection.

---

## 💡 How It Works

1. **Launch**: Start the Chatrik desktop application
2. **Connect**: Scan QR code to authenticate with WhatsApp Web
3. **Configure**: Set up folder monitoring and target contacts through the intuitive UI
4. **Automate**: The app continuously watches your specified folders
5. **Send**: When new files are detected, they're automatically sent to your chosen WhatsApp contacts or groups

The application uses the powerful Baileys library for WhatsApp Web integration and Chokidar for efficient file system monitoring.

---

## 🛠️ Technologies Used

- **Electron**: Cross-platform desktop application framework
- **Baileys**: WhatsApp Web API library
- **Chokidar**: File system watcher
- **Node.js**: JavaScript runtime
- **HTML/CSS/JavaScript**: Frontend technologies
- **Pino**: High-performance logging
- **MIME Types**: File type detection

---

## 🔐 Finding WhatsApp IDs

To find contact or group IDs for automation:

- **Individual contacts**: Use format `phonenumber@c.us` (e.g., `1234567890@c.us`)
- **Groups**: Use format `groupid@g.us` 
- The application provides tools to help you identify the correct IDs for your contacts and groups

---

## 📱 Supported Platforms

- **Windows**: NSIS installer (.exe)
- **macOS**: DMG package (.dmg)
- **Linux**: AppImage (.AppImage)

---

## 🎨 UI Features

- Modern, responsive design
- Interactive animations (cat and truck themes)
- Real-time status updates
- File monitoring indicators
- Connection status display
- Beautiful power button controls

---

## 🤝 Contributing

Pull requests and ideas are welcome! Feel free to fork and enhance this project.

### Development Setup

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

## 📄 License

MIT License © [Rishabh Shukla](https://github.com/rakshitbhai)

---

## 🙋‍♂️ Support

If you have any questions or need help with Chatrik, feel free to:
- Open an issue on GitHub
- Contact the maintainer

---

> **Chatrik** - Built to help content creators, video editors, and teams automate their WhatsApp workflows and save valuable time.
