const express = require("express");
const Transaction = require("../models/Transaction");
const User = require("../models/User");

const router = express.Router();

// GET: Transactions Page
router.get("/", async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.redirect("/auth/login");
        }

        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.redirect("/auth/login");
        }

        // Get all transactions for this user, sorted by most recent first
        const transactions = await Transaction.find({ userId: user._id })
            .sort({ createdAt: -1 })
            .lean();

        res.render("transactions", { user, transactions });
    } catch (err) {
        console.error("Error loading transactions:", err);
        res.redirect("/dashboard");
    }
});

// API: Get transactions data (for AJAX requests)
router.get("/api/list", async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ success: false, error: "Not authenticated" });
        }

        const transactions = await Transaction.find({ userId: req.session.userId })
            .sort({ createdAt: -1 })
            .lean();

        res.json({ success: true, transactions });
    } catch (err) {
        console.error("Error fetching transactions:", err);
        res.status(500).json({ success: false, error: "Failed to fetch transactions" });
    }
});

module.exports = router;
