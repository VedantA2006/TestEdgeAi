// routes/history.js
const express = require("express");
const Strategy = require("../models/Strategy");
const User = require("../models/User");
const path = require("path");
const fs = require("fs");

const router = express.Router();

// Get all strategies for logged-in user
router.get("/", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const limit = parseInt(req.query.limit) || 50;
    const strategies = await Strategy.find({ userId: req.session.userId })
      .sort({ createdAt: -1 })
      .limit(limit);

    res.json({ success: true, strategies });
  } catch (err) {
    console.error("Error fetching history:", err);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

// Get single strategy by ID (for detail view)
router.get("/:id", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const strategy = await Strategy.findOne({
      _id: req.params.id,
      userId: req.session.userId
    }).populate('userId', 'username email');

    if (!strategy) {
      return res.status(404).json({ error: "Strategy not found" });
    }

    res.json({ success: true, strategy });
  } catch (err) {
    console.error("Error fetching strategy:", err);
    res.status(500).json({ error: "Failed to fetch strategy" });
  }
});

// Download strategy as JSON
router.get("/:id/download", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const strategy = await Strategy.findOne({
      _id: req.params.id,
      userId: req.session.userId
    });

    if (!strategy) {
      return res.status(404).json({ error: "Strategy not found" });
    }

    const downloadData = {
      strategyName: `${strategy.assets.join('-')}-${strategy.timeframe}`,
      plan: strategy.plan,
      timeframe: strategy.timeframe,
      assets: strategy.assets,
      indicators: strategy.indicators,
      strategyLogic: strategy.strategyLogic,
      metrics: strategy.metrics,
      yearlyReturns: strategy.yearlyReturns,
      monthlyReturns: strategy.monthlyReturns,
      createdAt: strategy.createdAt,
      completedAt: strategy.updatedAt
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="strategy_${strategy._id}.json"`);
    res.json(downloadData);
  } catch (err) {
    console.error("Error downloading strategy:", err);
    res.status(500).json({ error: "Failed to download" });
  }
});

// Download Python code
router.get("/:id/code", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const strategy = await Strategy.findOne({
      _id: req.params.id,
      userId: req.session.userId
    });

    if (!strategy) {
      return res.status(404).json({ error: "Strategy not found" });
    }

    if (!strategy.generatedCode) {
      return res.status(404).json({ error: "Code not available" });
    }

    res.setHeader('Content-Type', 'text/x-python');
    res.setHeader('Content-Disposition', `attachment; filename="strategy_${strategy._id}.py"`);
    res.send(strategy.generatedCode);
  } catch (err) {
    console.error("Error downloading code:", err);
    res.status(500).json({ error: "Failed to download code" });
  }
});

// Download equity curve image
router.get("/:id/chart", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const strategy = await Strategy.findOne({
      _id: req.params.id,
      userId: req.session.userId
    });

    if (!strategy) {
      return res.status(404).json({ error: "Strategy not found" });
    }

    const chartPath = path.join(__dirname, "../temp/equity.png");
    
    if (!fs.existsSync(chartPath)) {
      return res.status(404).json({ error: "Chart not available" });
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="equity_curve_${strategy._id}.png"`);
    
    const fileStream = fs.createReadStream(chartPath);
    fileStream.pipe(res);
  } catch (err) {
    console.error("Error downloading chart:", err);
    res.status(500).json({ error: "Failed to download chart" });
  }
});

// Delete strategy
router.delete("/:id", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const strategy = await Strategy.findOneAndDelete({
      _id: req.params.id,
      userId: req.session.userId
    });

    if (!strategy) {
      return res.status(404).json({ error: "Strategy not found" });
    }

    // Remove from user's strategy array
    await User.findByIdAndUpdate(req.session.userId, {
      $pull: { strategies: strategy._id }
    });

    res.json({ success: true, message: "Strategy deleted" });
  } catch (err) {
    console.error("Error deleting strategy:", err);
    res.status(500).json({ error: "Failed to delete strategy" });
  }
});

// Get statistics for user
router.get("/stats/summary", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const strategies = await Strategy.find({
      userId: req.session.userId,
      status: "completed"
    });

    const totalRuns = await Strategy.countDocuments({ userId: req.session.userId });
    const completedRuns = strategies.length;
    const failedRuns = totalRuns - completedRuns;
    const totalCreditsUsed = strategies.reduce((sum, s) => sum + (s.creditsUsed || 0), 0);

    res.json({
      success: true,
      stats: {
        totalRuns,
        completedRuns,
        failedRuns,
        totalCreditsUsed
      }
    });
  } catch (err) {
    console.error("Error fetching stats:", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

module.exports = router;