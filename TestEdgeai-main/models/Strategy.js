// models/Strategy.js
const mongoose = require("mongoose");

const strategySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  
  // Core strategy data
  prompt: { type: String, required: true },
  name: { type: String, default: null },  // User-defined strategy name
  generatedCode: { type: String },
  strategyLogic: { type: String },
  
  // Configuration
  plan: {
    type: String,
    enum: ["quick", "deep", "smart", "research"],  // quick/deep = new; smart/research = legacy
    required: true
  },
  timeframe: { type: String, required: true },
  assets: [{ type: String }],
  indicators: [{ type: String }],
  
  // Credits & Cost
  creditsUsed: { type: Number, required: true },
  
  // Execution
  status: {
    type: String,
    enum: ["pending", "running", "completed", "failed", "optimizing"],
    default: "pending"
  },
  sessionId: { type: String },
  
  // Deep Mode Features used
  deepFeatures: {
    optimization: { type: Boolean, default: false },
    walkForward: { type: Boolean, default: false },
    monteCarlo: { type: Boolean, default: false },
    positionSizing: { type: Boolean, default: false }
  },
  
  // Results
  output: { type: String },
  metrics: {
    type: Map,
    of: String
  },
  yearlyReturns: [{
    year: String,
    value: Number
  }],
  monthlyReturns: [{
    month: String,
    year: String,
    monthIndex: Number,
    value: Number
  }],
  
  // ✅ OPTIMIZATION FIELDS (NEW)
  isOptimization: {
    type: Boolean,
    default: false,
    index: true
  },
  parentStrategyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Strategy",
    index: true
  },
  optimizationPrompt: { type: String },
  optimizationNumber: { type: Number, min: 1, max: 3 },
  optimizationGoal: { type: String },
  
  // Comparison data for optimizations
  comparisonData: {
    originalMetrics: { type: Map, of: String },
    improvementNotes: { type: String }
  },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual: Get child optimizations
strategySchema.virtual("optimizations", {
  ref: "Strategy",
  localField: "_id",
  foreignField: "parentStrategyId",
  options: { sort: { optimizationNumber: 1 } }
});

// Virtual: Get optimization count for parent
strategySchema.virtual("optimizationCount", {
  ref: "Strategy",
  localField: "_id",
  foreignField: "parentStrategyId",
  count: true
});

// Indexes for optimization queries
strategySchema.index({ parentStrategyId: 1, isOptimization: 1 });
strategySchema.index({ plan: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("Strategy", strategySchema);