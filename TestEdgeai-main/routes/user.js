// routes/user.js
const express  = require("express");
const bcrypt   = require("bcrypt");
const User     = require("../models/User");

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Not authenticated." });
  }
  next();
}

/* ════════════════════════════════════════════════════════
   PUT /api/user/profile
   Update username, email, and optionally password
════════════════════════════════════════════════════════ */
router.put("/profile", requireAuth, async (req, res) => {
  const { username, email, currentPassword, newPassword } = req.body;

  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: "User not found." });

    /* ── Username ── */
    if (username && username.trim()) {
      const trimmed = username.trim();
      if (trimmed.length < 2 || trimmed.length > 32) {
        return res.status(400).json({ error: "Username must be 2–32 characters." });
      }
      // Check uniqueness (ignore self)
      const existing = await User.findOne({ username: trimmed, _id: { $ne: user._id } });
      if (existing) return res.status(400).json({ error: "Username already taken." });
      user.username = trimmed;
    }

    /* ── Email ── */
    if (email !== undefined) {
      user.email = email.trim() || null;
    }

    /* ── Password change ── */
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: "Current password is required to set a new one." });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ error: "New password must be at least 6 characters." });
      }
      const match = await bcrypt.compare(currentPassword, user.password);
      if (!match) {
        return res.status(400).json({ error: "Current password is incorrect." });
      }
      user.password = await bcrypt.hash(newPassword, 12);
    }

    await user.save();
    res.json({ success: true, message: "Profile updated." });

  } catch (err) {
    console.error("PUT /profile error:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

/* ════════════════════════════════════════════════════════
   DELETE /api/user/history/all
   Clears ALL backtest history entries for the user
════════════════════════════════════════════════════════ */
router.delete("/history/all", requireAuth, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.session.userId, {
      $set: { backtestHistory: [] }
    });
    res.json({ success: true, message: "All backtest history cleared." });
  } catch (err) {
    console.error("DELETE /history/all error:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

/* ════════════════════════════════════════════════════════
   GET /api/user/me
   Returns current user's public profile data
════════════════════════════════════════════════════════ */
router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId)
      .select("username email creditTokens totalBacktests totalCreditsSpent createdAt updatedAt");
    if (!user) return res.status(404).json({ error: "User not found." });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;