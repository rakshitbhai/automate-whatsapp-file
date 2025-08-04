// platform-utils.js - Cross-platform utility functions

const { execSync } = require("child_process");
const { PLATFORM_COMMANDS } = require("./constants");

class PlatformUtils {
    /**
     * Execute platform-specific shutdown command
     * @returns {boolean} Success status
     */
    static executeShutdown() {
        const command = PLATFORM_COMMANDS.SHUTDOWN[process.platform];

        if (!command) {
            throw new Error("Unsupported platform for shutdown");
        }

        try {
            execSync(command);
            return true;
        } catch (error) {
            throw new Error(`Shutdown failed: ${error.message}`);
        }
    }

    /**
     * Play sound file using platform-specific command
     * @param {string} soundPath - Path to the sound file
     * @returns {boolean} Success status
     */
    static playSound(soundPath) {
        const commandFn = PLATFORM_COMMANDS.SOUND_PLAY[process.platform];

        if (!commandFn) {
            throw new Error("Unsupported platform for sound playback");
        }

        try {
            const command = commandFn(soundPath);
            execSync(command, { stdio: "ignore" });
            return true;
        } catch (error) {
            throw new Error(`Sound playback failed: ${error.message}`);
        }
    }

    /**
     * Get platform-specific icon path
     * @param {string} assetsDir - Assets directory path
     * @returns {string} Platform-specific icon path
     */
    static getIconPath(assetsDir) {
        const path = require("path");

        const iconMap = {
            win32: "icon.ico",
            darwin: "icon.icns",
            default: "icon.png"
        };

        const iconFile = iconMap[process.platform] || iconMap.default;
        return path.join(assetsDir, iconFile);
    }

    /**
     * Get current platform information
     * @returns {object} Platform info
     */
    static getPlatformInfo() {
        return {
            platform: process.platform,
            arch: process.arch,
            isWindows: process.platform === "win32",
            isMac: process.platform === "darwin",
            isLinux: process.platform === "linux"
        };
    }
}

module.exports = PlatformUtils;
