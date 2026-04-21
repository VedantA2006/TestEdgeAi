// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const session = require("express-session");

const strategyRoute = require("./routes/strategy");
const authRoute = require("./routes/auth");
const historyRoute = require("./routes/history"); // NEW
const transactionsRoute = require("./routes/transactions");

const app = express();
console.log("Server starting...");

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log("❌ MongoDB connection error:", err));

// EJS Setup
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'super_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Static Files
app.use("/temp", express.static(path.join(__dirname, "temp")));
app.use("/public", express.static(path.join(__dirname, "public")));

// Routes
app.use("/api/strategy", strategyRoute);
app.use("/api/history", historyRoute); // NEW
app.use("/auth", authRoute);
app.use("/transactions", transactionsRoute);

// Add to server.js after other routes
const purchaseRoute = require("./routes/purchase");
app.use("/purchase", purchaseRoute);
// server.js - Add after other route imports
const optimizationRoute = require("./routes/optimization");
app.use("/api/optimization", optimizationRoute);


// Protected Dashboard Route
app.get("/dashboard", async (req, res) => {
    if (!req.session.userId) {
        return res.redirect("/auth/login");
    }
    
    const User = require("./models/User");
    const user = await User.findById(req.session.userId);
    
    res.render("dashboard", { user });
});

// Landing Page Route
app.get("/", (req, res) => {
    // Check if user is logged in
    const isLoggedIn = req.session.userId ? true : false;
    res.render("landing", { isLoggedIn });
});

// Terms & Conditions Route
app.get("/terms", (req, res) => {
    res.render("terms");
});

// Privacy Policy Route
app.get("/privacy", (req, res) => {
    res.render("privacy");
});

// History Page Route
app.get("/history", async (req, res) => {
    if (!req.session.userId) {
        return res.redirect("/auth/login");
    }
    
    const User = require("./models/User");
    const user = await User.findById(req.session.userId);
    
    res.render("history", { user });
});

// Add to server.js
app.get("/history/:id", async (req, res) => {
    if (!req.session.userId) {
        return res.redirect("/auth/login");
    }
    
    const User = require("./models/User");
    const user = await User.findById(req.session.userId);
    
    res.render("history-detail", { user });
});

// Profile Route
app.get("/profile", async (req, res) => {
    if (!req.session.userId) {
        return res.redirect("/auth/login");
    }
    
    const User = require("./models/User");
    const user = await User.findById(req.session.userId);
    
    res.render("profile", { user });
});

// Logout Route
app.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/auth/login");
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});