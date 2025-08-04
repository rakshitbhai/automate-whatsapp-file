// progress-tracker.js - Progress tracking utilities

const { PROGRESS_CONFIG } = require("./constants");

class ProgressTracker {
    constructor(fileName, fileSize, destination, fileType, transferId) {
        this.fileName = fileName;
        this.fileSize = fileSize;
        this.destination = destination;
        this.fileType = fileType;
        this.transferId = transferId;
        this.startTime = Date.now();
        this.lastUpdateTime = 0;
        this.progressInterval = null;
        this.simulatedProgress = 0;
    }

    /**
     * Create progress update object
     * @param {number} progress - Progress percentage
     * @param {number} elapsedSeconds - Elapsed time in seconds
     * @param {string} speed - Transfer speed
     * @param {string} eta - Estimated time remaining
     * @returns {object} Progress update object
     */
    createProgressUpdate(progress, elapsedSeconds, speed, eta) {
        return {
            file: this.fileName,
            progress: Math.round(progress),
            elapsed: elapsedSeconds,
            speed: speed,
            eta: eta,
            destination: this.destination,
            fileType: this.fileType,
            fileSize: this.formatFileSize(this.fileSize),
            transferId: this.transferId
        };
    }

    /**
     * Format file size for display
     * @param {number} sizeInBytes - Size in bytes
     * @returns {string} Formatted size
     */
    formatFileSize(sizeInBytes) {
        return `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    /**
     * Calculate transfer speed
     * @param {number} bytesProcessed - Bytes processed
     * @param {number} elapsedSeconds - Elapsed time in seconds
     * @returns {string} Speed in MB/s
     */
    calculateSpeed(bytesProcessed, elapsedSeconds) {
        if (elapsedSeconds <= 0) return "0.00";
        return (bytesProcessed / (1024 * 1024) / elapsedSeconds).toFixed(2);
    }

    /**
     * Calculate ETA based on progress
     * @param {number} progress - Current progress percentage
     * @param {number} elapsedSeconds - Elapsed time in seconds
     * @returns {string} ETA string
     */
    calculateETA(progress, elapsedSeconds) {
        if (progress >= 100) return "Complete!";
        if (progress <= 0 || elapsedSeconds <= 0) return "Calculating...";

        const remainingPercent = 100 - progress;
        const timePerPercent = elapsedSeconds / progress;
        const remainingSeconds = Math.round(remainingPercent * timePerPercent);

        return `~${remainingSeconds}s remaining`;
    }

    /**
     * Process real progress data from upload callback
     * @param {object} progressData - Progress data from upload
     * @param {function} onUpdate - Callback for progress updates
     */
    processRealProgress(progressData, onUpdate) {
        const now = Date.now();

        // Only update at most once per second to avoid UI spam
        if (now - this.lastUpdateTime >= 1000) {
            this.lastUpdateTime = now;
            const elapsedSeconds = Math.floor((now - this.startTime) / 1000);
            const percent = progressData.total
                ? Math.round((progressData.uploaded / progressData.total) * 100)
                : 0;

            const speed = this.calculateSpeed(progressData.uploaded, elapsedSeconds);
            const eta = this.calculateETA(percent, elapsedSeconds);

            onUpdate(this.createProgressUpdate(percent, elapsedSeconds, speed, eta));
        }
    }

    /**
     * Start simulated progress tracking
     * @param {number} fileSizeMB - File size in MB
     * @param {function} onUpdate - Callback for progress updates
     */
    startSimulatedProgress(fileSizeMB, onUpdate) {
        const estimatedTimeSeconds = Math.max(
            20,
            Math.min(300, Math.round(fileSizeMB * 0.5))
        );

        const progressIncrement =
            PROGRESS_CONFIG.PROGRESS_PHASES.FINAL /
            ((estimatedTimeSeconds * 1000) / PROGRESS_CONFIG.UPDATE_FREQUENCY_MS);

        this.progressInterval = setInterval(() => {
            const elapsedMs = Date.now() - this.startTime;
            const elapsedSeconds = Math.floor(elapsedMs / 1000);

            // Calculate simulated progress with phases
            if (this.simulatedProgress < PROGRESS_CONFIG.PROGRESS_PHASES.INITIAL) {
                this.simulatedProgress += progressIncrement * 2; // Faster initial phase
            } else if (this.simulatedProgress < PROGRESS_CONFIG.PROGRESS_PHASES.MAIN) {
                this.simulatedProgress += progressIncrement; // Steady main phase
            } else if (this.simulatedProgress < PROGRESS_CONFIG.PROGRESS_PHASES.FINAL) {
                this.simulatedProgress += progressIncrement * 0.5; // Slower final phase
            }

            // Cap at 90% - actual completion will move it to 100%
            this.simulatedProgress = Math.min(PROGRESS_CONFIG.PROGRESS_PHASES.FINAL, this.simulatedProgress);

            const processedEstimate = (this.simulatedProgress / 100) * this.fileSize;
            const speed = this.calculateSpeed(processedEstimate, elapsedSeconds);
            const eta = `~${Math.round(estimatedTimeSeconds - elapsedSeconds)}s remaining`;

            onUpdate(this.createProgressUpdate(this.simulatedProgress, elapsedSeconds, speed, eta));
        }, PROGRESS_CONFIG.UPDATE_FREQUENCY_MS);
    }

    /**
     * Send final completion update
     * @param {function} onUpdate - Callback for progress updates
     * @param {number} actualElapsedSeconds - Actual elapsed time
     */
    sendCompletionUpdate(onUpdate, actualElapsedSeconds) {
        const fileSizeMB = this.fileSize / (1024 * 1024);
        const finalSpeed = (fileSizeMB / (actualElapsedSeconds || 1)).toFixed(2);

        onUpdate(this.createProgressUpdate(100, actualElapsedSeconds, finalSpeed, "Complete!"));
    }

    /**
     * Send initial progress update
     * @param {function} onUpdate - Callback for progress updates
     */
    sendInitialUpdate(onUpdate) {
        onUpdate(this.createProgressUpdate(1, 0, "0.00", "Calculating..."));
    }

    /**
     * Clean up progress tracker
     */
    cleanup() {
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
    }
}

module.exports = ProgressTracker;
