// constants.js - Centralized constants to avoid repetition

const SUPPORTED_FILE_EXTENSIONS = {
    // Video formats
    VIDEO: [".mp4", ".mov", ".avi", ".mkv", ".wmv", ".flv", ".webm", ".m4v"],

    // Image formats
    IMAGE: [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"],

    // Document formats
    DOCUMENT: [".pdf", ".doc", ".docx", ".txt", ".xls", ".xlsx", ".ppt", ".pptx"],

    // Audio formats
    AUDIO: [".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a"]
};

// Flatten all extensions into a single array
const ALL_SUPPORTED_EXTENSIONS = [
    ...SUPPORTED_FILE_EXTENSIONS.VIDEO,
    ...SUPPORTED_FILE_EXTENSIONS.IMAGE,
    ...SUPPORTED_FILE_EXTENSIONS.DOCUMENT,
    ...SUPPORTED_FILE_EXTENSIONS.AUDIO
];

const PLATFORM_COMMANDS = {
    SHUTDOWN: {
        win32: "shutdown /s /f /t 10",
        darwin: 'osascript -e "tell app \\"System Events\\" to shut down"',
        linux: "systemctl poweroff"
    },
    SOUND_PLAY: {
        win32: (soundPath) => `powershell -c (New-Object Media.SoundPlayer "${soundPath}").PlaySync()`,
        darwin: (soundPath) => `afplay "${soundPath}"`,
        linux: (soundPath) => `aplay "${soundPath}"`
    }
};

const FILE_SIZE_LIMITS = {
    WARNING_THRESHOLD_GB: 1, // 1GB
    MAX_WHATSAPP_SIZE_GB: 2, // 2GB
    LARGE_FILE_THRESHOLD_MB: 500 // 500MB
};

const PROGRESS_CONFIG = {
    UPDATE_FREQUENCY_MS: 800,
    PROGRESS_PHASES: {
        INITIAL: 10,
        MAIN: 85,
        FINAL: 90
    }
};

const TIMEOUTS = {
    CONNECTION_RETRY_MS: 5000,
    INITIALIZATION_RETRY_MS: 10000,
    FILE_RETRY_MS: 10000,
    SHUTDOWN_DELAY_MS: 5000,
    MESSAGE_STATUS_LISTENER_CLEANUP_MS: 60000,
    FILE_ACCESSIBILITY_CHECK_MS: 10000,
    MESSAGE_VERIFICATION_DELAY_MS: 3000
};

const IPC_EVENTS = {
    // WhatsApp events
    INIT_WHATSAPP: "init-whatsapp",
    WHATSAPP_LOADING: "whatsapp-loading",
    WHATSAPP_QR: "whatsapp-qr",
    WHATSAPP_READY: "whatsapp-ready",
    WHATSAPP_AUTHENTICATED: "whatsapp-authenticated",
    WHATSAPP_DISCONNECTED: "whatsapp-disconnected",
    WHATSAPP_CHATS: "whatsapp-chats",
    CHATS_LOADING: "chats-loading",
    LOGOUT_WHATSAPP: "logout-whatsapp",
    RESET_AUTH_DATA: "reset-auth-data",
    CHECK_CONNECTION: "check-connection",

    // File transfer events
    START_WATCHING: "start-watching",
    STOP_WATCHING: "stop-watching",
    UPLOAD_PROGRESS: "upload-progress",
    FILE_SENT_CONFIRMED: "file-sent-confirmed",
    FILE_SEND_FAILED: "file-send-failed",
    RETRY_FILE: "retry-file",
    CANCEL_TRANSFERS: "cancel-transfers",

    // Configuration events
    LOAD_USER_CONFIG: "load-user-config",
    SAVE_USER_CONFIG: "save-user-config",
    UPDATE_CAPTION: "update-caption",
    TOGGLE_SHUTDOWN: "toggle-shutdown",
    SELECT_FOLDER: "select-folder",
    SET_MAX_RETRIES: "set-max-retries",

    // UI events
    LOG: "log",
    ERROR: "error",
    PLAY_SOUND: "play-sound",
    SHUTDOWN_STATE_CHANGED: "shutdown-state-changed"
};

const WHATSAPP_CONFIG = {
    BROWSER_INFO: ["WhatsApp Large File Sender", "Chrome", "100.0.0.0"],
    CONNECTION_TIMEOUT_MS: 60000,
    DEFAULT_MAX_RETRIES: 5,
    CHOKIDAR_CONFIG: {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
            stabilityThreshold: 15000,
            pollInterval: 2000
        },
        usePolling: true,
        interval: 5000,
        binaryInterval: 10000,
        depth: 0,
        ignorePermissionErrors: true
    }
};

// UI Constants for DOM manipulation
const UI_ELEMENTS = {
    // Connection elements
    CONNECT_BTN: 'connect-btn',
    LOGOUT_BTN: 'logout-btn',
    CONNECTION_STATUS: 'connection-status',
    QR_CONTAINER: 'qr-container',
    LOADING_INDICATOR: 'loading-indicator',

    // Theme elements
    THEME_TOGGLE: 'theme-toggle',

    // Folder selection
    SELECT_FOLDER_BTN: 'select-folder-btn',
    FOLDER_PATH: 'folder-path',

    // Chat elements
    CHAT_SEARCH: 'chat-search',
    CHAT_DROPDOWN: 'chat-dropdown',
    SELECTED_CHAT_ID: 'selected-chat-id',
    SELECTED_CHAT_DISPLAY: 'selected-chat-display',
    CHATS_LOADING_INDICATOR: 'chats-loading-indicator',

    // Control buttons
    START_BTN: 'start-btn',
    STOP_BTN: 'stop-btn',
    CAPTION_INPUT: 'caption-input',

    // Animation elements
    CAT_ANIMATION_FRAME: 'cat-animation-frame',
    TRUCK_ANIMATION_CONTAINER: 'truck-animation-container',
    TRUCK_ANIMATION_FRAME: 'truck-animation-frame',

    // Log container
    LOG_CONTAINER: 'log-container'
};

// CSS Classes
const CSS_CLASSES = {
    HIDDEN: 'hidden',
    VISIBLE: 'visible',
    LOADING: 'loading',
    ERROR: 'error',
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    DARK_MODE: 'dark-mode'
};

// Local Storage Keys
const STORAGE_KEYS = {
    THEME: 'theme',
    FOLDER_PATH: 'folderPath',
    CHAT_ID: 'chatId',
    CAPTION: 'caption',
    MAX_RETRIES: 'maxRetries'
};

module.exports = {
    SUPPORTED_FILE_EXTENSIONS,
    ALL_SUPPORTED_EXTENSIONS,
    PLATFORM_COMMANDS,
    FILE_SIZE_LIMITS,
    PROGRESS_CONFIG,
    TIMEOUTS,
    IPC_EVENTS,
    WHATSAPP_CONFIG,
    UI_ELEMENTS,
    CSS_CLASSES,
    STORAGE_KEYS
};
