# 📤 Automate WhatsApp File Sender

A smart automation tool to **monitor a folder** and instantly **send any new video file** to a WhatsApp contact or group — as a **document**, using WhatsApp Web.

---

## ✨ Features

- 📁 **Auto-detect files**: Watches a folder for new video files (like from Adobe Premiere exports).
- 📲 **WhatsApp automation**: Sends the video as a **document** to a specified WhatsApp user or group.
- ⚙️ **Easy setup**: Quick configuration, minimal code change required.

---

## 📂 Project Structure

```
.
├── README.md             # You're reading it!
├── find.js               # Utility to retrieve WhatsApp ID
├── main.js               # Main automation script
├── package-lock.json     # Auto-generated dependency lock file
└── package.json          # Project metadata and dependencies
```

---

## 🚀 Getting Started

### 1. Clone this repo

```bash
git clone https://github.com/rakshitbhai/automate-whatsapp-file.git
cd automate-whatsapp-file
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set your target and folder

Open `main.js`:

```js
const targetId = '1234567890@c.us'; // or groupID@g.us
const directoryPath = '/path/to/your/export/folder';
```

### 4. Run the app

```bash
node main.js
```

🔍 On first run, a QR code will appear — scan it using your WhatsApp app to authenticate.

---

## 💡 How It Works

- Listens for new `.mp4`, `.mov`, or `.avi` files in the given folder.
- When a file is added, it’s sent through WhatsApp Web as a **document**.
- 
---

## 🔐 WhatsApp ID Helper

Need to find a contact or group ID? Run:

```bash
node find.js
```

👈 Type the name of the person or group to get their WhatsApp ID.

---

## 📌 Notes

- Format for individuals: `phonenumber@c.us`  
- Format for groups: `groupid@g.us`
- Works while WhatsApp Web session stays logged in.

---

## 🤝 Contributing

Pull requests and ideas are welcome! Feel free to fork and enhance this project.

---

## �� License

MIT License © [rakshitbhai](https://github.com/rakshitbhai)

---

> Built to help video editors & content teams save time and stay consistent.

