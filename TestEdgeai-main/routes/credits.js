// routes/credits.js
const express = require("express");
const User    = require("../models/User");

const router = express.Router();

/* ── Auth guard ── */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Not authenticated." });
  }
  next();
}

/* Credit pack definitions — amounts and their prices */
const PACKS = {
  50:  { price: 4.99,  label: "Starter"   },
  200: { price: 14.99, label: "Popular"   },
  500: { price: 29.99, label: "Pro Value" },
};

/* ════════════════════════════════════════════════════════════════════════════
   POST /api/credits/buy
   Body: { amount: 50 | 200 | 500 }
════════════════════════════════════════════════════════════════════════════ */
router.post("/buy", requireAuth, async (req, res) => {
  const amount = parseInt(req.body.amount, 10);

  if (!PACKS[amount]) {
    return res.status(400).json({
      error: `Invalid pack. Choose from: ${Object.keys(PACKS).join(", ")}`,
    });
  }

  try {
    const user = await User.findByIdAndUpdate(
      req.session.userId,
      { $inc: { creditTokens: amount } },
      { new: true, select: "creditTokens username" }
    );

    if (!user) return res.status(404).json({ error: "User not found." });

    console.log(`Credits purchased: +${amount} for user ${user.username} → balance ${user.creditTokens}`);

    res.json({
      success:    true,
      added:      amount,
      newBalance: user.creditTokens,
      pack:       PACKS[amount],
    });
  } catch (err) {
    console.error("POST /credits/buy error:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

/* ════════════════════════════════════════════════════════════════════════════
   GET /api/credits/balance
   ─ Quick credit check (used by frontend on load)
════════════════════════════════════════════════════════════════════════════ */
router.get("/balance", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).select("creditTokens");
    if (!user) return res.status(404).json({ error: "User not found." });
    res.json({ creditTokens: user.creditTokens });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;