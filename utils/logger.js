// logger.js - Centralized logging utility

const fs = require("fs");
const path = require("path");

class Logger {
    constructor(logFilePath, mainWindow = null) {
        this.logFilePath = logFilePath;
        this.mainWindow = mainWindow;
    }

    /**
     * Update the main window reference
     * @param {object} mainWindow - Electron main window
     */
    setMainWindow(mainWindow) {
        this.mainWindow = mainWindow;
    }

    /**
     * Log message to file and UI
     * @param {string} message - Message to log
     * @param {boolean} isError - Whether this is an error message
     */
    log(message, isError = false) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}\n`;

        // Always write to log file
        try {
            fs.appendFileSync(this.logFilePath, logMessage);
        } catch (error) {
            console.error("Failed to write to log file:", error);
        }

        // Only send to UI if mainWindow exists AND is not destroyed
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            try {
                const eventType = isError ? "error" : "log";
                this.mainWindow.webContents.send(eventType, message);
            } catch (error) {
                console.error("Failed to send log to renderer:", error);
            }
        }

        console.log(logMessage);
    }

    /**
     * Log error message
     * @param {string} message - Error message
     */
    error(message) {
        this.log(message, true);
    }

    /**
     * Log info message
     * @param {string} message - Info message
     */
    info(message) {
        this.log(message, false);
    }

    /**
     * Log with custom formatting
     * @param {string} level - Log level (INFO, ERROR, WARN, etc.)
     * @param {string} message - Message to log
     */
    logWithLevel(level, message) {
        const formattedMessage = `[${level}] ${message}`;
        const isError = level === "ERROR" || level === "WARN";
        this.log(formattedMessage, isError);
    }

    /**
     * Log system information
     * @param {object} systemInfo - System information object
     */
    logSystemInfo(systemInfo) {
        const { totalMemGB, freeMemGB, cpuCount } = systemInfo;
        this.info(`System info: ${totalMemGB}GB RAM (${freeMemGB}GB free), ${cpuCount} CPUs`);
    }

    /**
     * Log file processing information
     * @param {string} filePath - Path to the file
     * @param {object} fileInfo - File information object
     */
    logFileProcessing(filePath, fileInfo) {
        const fileName = path.basename(filePath);
        this.info(`Processing file: ${filePath}`);
        this.info(`File size: ${fileInfo.size} bytes (${fileInfo.sizeMB.toFixed(2)}MB)`);
    }

    /**
     * Log transfer completion
     * @param {string} messageId - WhatsApp message ID
     * @param {number} totalTime - Total transfer time in seconds
     * @param {number} speedMBps - Average speed in MB/s
     */
    logTransferCompletion(messageId, totalTime, speedMBps) {
        this.info(`✅ Document sent successfully! Message ID: ${messageId}`);
        this.info(`Transfer completed in ${totalTime} seconds (average speed: ${speedMBps.toFixed(2)} MB/s)`);
    }

    /**
     * Log connection status changes
     * @param {string} status - Connection status
     * @param {string} details - Additional details
     */
    logConnectionStatus(status, details = "") {
        const message = details ? `${status}: ${details}` : status;
        this.info(`WhatsApp connection status: ${message}`);
    }

    /**
     * Clear old log entries (keep last N entries)
     * @param {number} maxEntries - Maximum number of entries to keep
     */
    rotateLog(maxEntries = 1000) {
        try {
            if (!fs.existsSync(this.logFilePath)) return;

            const logContent = fs.readFileSync(this.logFilePath, "utf8");
            const lines = logContent.split("\n");

            if (lines.length > maxEntries) {
                const newContent = lines.slice(-maxEntries).join("\n");
                fs.writeFileSync(this.logFilePath, newContent, "utf8");
                this.info(`Log rotated: kept last ${maxEntries} entries`);
            }
        } catch (error) {
            console.error("Failed to rotate log file:", error);
        }
    }
}

module.exports = Logger;
