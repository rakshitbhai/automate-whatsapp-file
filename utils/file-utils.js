// file-utils.js - File handling utilities

const fs = require("fs");
const path = require("path");
const mime = require("mime-types");
const { ALL_SUPPORTED_EXTENSIONS, FILE_SIZE_LIMITS } = require("./constants");

class FileUtils {
    /**
     * Check if file extension is supported
     * @param {string} filePath - Path to the file
     * @returns {boolean} Whether file is supported
     */
    static isFileSupported(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        return ALL_SUPPORTED_EXTENSIONS.includes(ext) || ext === "";
    }

    /**
     * Get file statistics and validation
     * @param {string} filePath - Path to the file
     * @returns {object} File stats and validation info
     */
    static validateFile(filePath) {
        try {
            const fileStats = fs.statSync(filePath);
            const fileSizeMB = fileStats.size / (1024 * 1024);
            const fileSizeGB = fileSizeMB / 1024;

            return {
                stats: fileStats,
                size: fileStats.size,
                sizeMB: fileSizeMB,
                sizeGB: fileSizeGB,
                isEmpty: fileStats.size === 0,
                isLarge: fileSizeMB > FILE_SIZE_LIMITS.LARGE_FILE_THRESHOLD_MB,
                exceedsWarningThreshold: fileSizeGB > FILE_SIZE_LIMITS.WARNING_THRESHOLD_GB,
                exceedsMaxSize: fileSizeGB > FILE_SIZE_LIMITS.MAX_WHATSAPP_SIZE_GB,
                isValid: fileStats.size > 0 && fileSizeGB <= FILE_SIZE_LIMITS.MAX_WHATSAPP_SIZE_GB
            };
        } catch (error) {
            throw new Error(`File validation failed: ${error.message}`);
        }
    }

    /**
     * Check if file is accessible and not locked
     * @param {string} filePath - Path to the file
     * @returns {boolean} Whether file is accessible
     */
    static isFileAccessible(filePath) {
        try {
            const fd = fs.openSync(filePath, "r");
            fs.closeSync(fd);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get MIME type for file
     * @param {string} filePath - Path to the file
     * @returns {string} MIME type
     */
    static getMimeType(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        return mime.lookup(ext) || "application/octet-stream";
    }

    /**
     * Format file size for display
     * @param {number} sizeInBytes - Size in bytes
     * @returns {string} Formatted size string
     */
    static formatFileSize(sizeInBytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = sizeInBytes;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }

        return `${size.toFixed(2)} ${units[unitIndex]}`;
    }

    /**
     * Create directory if it doesn't exist
     * @param {string} dirPath - Directory path
     */
    static ensureDirectoryExists(dirPath) {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }

    /**
     * Safely remove directory and its contents
     * @param {string} dirPath - Directory path
     */
    static removeDirectory(dirPath) {
        if (fs.existsSync(dirPath)) {
            fs.rmSync(dirPath, { recursive: true, force: true });
        }
    }

    /**
     * Safely remove file
     * @param {string} filePath - File path
     */
    static removeFile(filePath) {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }

    /**
     * Read JSON file with error handling
     * @param {string} filePath - Path to JSON file
     * @param {object} defaultValue - Default value if file doesn't exist
     * @returns {object} Parsed JSON data
     */
    static readJsonFile(filePath, defaultValue = {}) {
        try {
            if (fs.existsSync(filePath)) {
                const rawData = fs.readFileSync(filePath, "utf8");
                return JSON.parse(rawData);
            }
        } catch (error) {
            console.error(`Error reading JSON file ${filePath}:`, error.message);
        }
        return defaultValue;
    }

    /**
     * Write JSON file with error handling
     * @param {string} filePath - Path to JSON file
     * @param {object} data - Data to write
     */
    static writeJsonFile(filePath, data) {
        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
            return true;
        } catch (error) {
            throw new Error(`Error writing JSON file ${filePath}: ${error.message}`);
        }
    }
}

module.exports = FileUtils;
