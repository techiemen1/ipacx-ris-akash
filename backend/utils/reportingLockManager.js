const activeLocks = new Map();

// Expire locks inactive for > 30 seconds
const LOCK_TIMEOUT_MS = 30000;

function cleanupExpiredLocks() {
  const now = Date.now();
  for (const [studyUID, lock] of activeLocks.entries()) {
    if (now - lock.lastHeartbeat > LOCK_TIMEOUT_MS) {
      activeLocks.delete(studyUID);
    }
  }
}

// Periodic cleanup task
const lockCleanupInterval = setInterval(cleanupExpiredLocks, 10000);
if (lockCleanupInterval.unref) lockCleanupInterval.unref();

module.exports = {
  acquireLock: (studyUID, user) => {
    cleanupExpiredLocks();
    if (!studyUID) return { success: false, isLocked: false, error: "studyUID required" };

    const existing = activeLocks.get(studyUID);
    const now = Date.now();
    const userId = user?.id || user?.userId || 'guest';
    const doctorName = user?.name || user?.username || user?.doctor_name || 'Radiologist';

    // If locked by ANOTHER user whose lock hasn't expired
    if (existing && String(existing.userId) !== String(userId)) {
      return {
        success: false,
        isLocked: true,
        lockedBy: {
          userId: existing.userId,
          doctorName: existing.doctorName,
          role: existing.role,
          startedAt: existing.startedAt
        }
      };
    }

    const lockObj = {
      studyUID,
      userId,
      doctorName,
      role: user?.role || 'DOCTOR',
      startedAt: existing?.startedAt || new Date().toISOString(),
      lastHeartbeat: now
    };

    activeLocks.set(studyUID, lockObj);
    return { success: true, isLocked: false, session: lockObj };
  },

  heartbeat: (studyUID, userId) => {
    cleanupExpiredLocks();
    const existing = activeLocks.get(studyUID);
    if (!existing) return false;
    if (String(existing.userId) === String(userId)) {
      existing.lastHeartbeat = Date.now();
      return true;
    }
    return false;
  },

  releaseLock: (studyUID, userId) => {
    cleanupExpiredLocks();
    const existing = activeLocks.get(studyUID);
    if (!existing) return true;
    if (String(existing.userId) === String(userId) || userId === 'admin') {
      activeLocks.delete(studyUID);
      return true;
    }
    return false;
  },

  getActiveLocks: () => {
    cleanupExpiredLocks();
    const result = {};
    for (const [uid, lock] of activeLocks.entries()) {
      result[uid] = {
        studyUID: lock.studyUID,
        userId: lock.userId,
        doctorName: lock.doctorName,
        role: lock.role,
        startedAt: lock.startedAt,
        lastHeartbeat: lock.lastHeartbeat
      };
    }
    return result;
  }
};
