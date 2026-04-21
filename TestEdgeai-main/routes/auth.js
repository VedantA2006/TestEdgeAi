const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const router = express.Router();

// Render Signup Page
router.get("/signup", (req, res) => {
    // Redirect to dashboard if already logged in
    if (req.session.userId) {
        return res.redirect("/dashboard");
    }
    res.render("signup", { error: null });
});

// Handle Signup Logic
router.post("/signup", async (req, res) => {
    const { username, password,email } = req.body;
    try {
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.render("signup", { error: "User already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, password: hashedPassword ,email});
        await newUser.save();

        res.redirect("/auth/login");
    } catch (err) {
        res.render("signup", { error: "Something went wrong. Try again." });
    }
});

// Render Login Page
router.get("/login", (req, res) => {
    // Redirect to dashboard if already logged in
    if (req.session.userId) {
        return res.redirect("/dashboard");
    }
    res.render("login", { error: null });
});

// Handle Login Logic
router.post("/login", async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username });
        if (!user) {
            return res.render("login", { error: "Invalid credentials" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.render("login", { error: "Invalid credentials" });
        }

        // Set user session
        req.session.userId = user._id;
        req.session.user = user;
        
        res.redirect("/dashboard");
    } catch (err) {
        res.render("login", { error: "Something went wrong." });
    }
});

// Handle Logout
router.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/auth/login");
    });
});

// Handle Password Change
router.post("/change-password", async (req, res) => {
    try {
        // Check if user is logged in
        if (!req.session.userId) {
            return res.status(401).json({ success: false, error: "Not authenticated" });
        }

        const { currentPassword, newPassword } = req.body;

        // Validate input
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, error: "All fields are required" });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, error: "New password must be at least 6 characters" });
        }

        // Get user from database
        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.status(404).json({ success: false, error: "User not found" });
        }

        // Verify current password
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, error: "Current password is incorrect" });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password
        user.password = hashedPassword;
        await user.save();

        res.json({ success: true, message: "Password updated successfully" });
    } catch (err) {
        console.error("Password change error:", err);
        res.status(500).json({ success: false, error: "Something went wrong. Try again." });
    }
});

module.exports = router;