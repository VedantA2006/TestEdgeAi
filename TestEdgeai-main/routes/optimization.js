// routes/optimization.js
const express = require("express");
const Strategy = require("../models/Strategy");
const User = require("../models/User");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");
const runPython = require("../utils/runPython");

const router = express.Router();
const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── POST: Start Optimization ────────────────────────────────────────────────
// OPTIMIZATION FLOW:
// 1. User clicks "Start Optimization" (16 credits, max 3 optimizations per strategy)
// 2. AI generates optimized code (max 2 attempts if generation fails)
// 3. Code is executed (max 3 execution attempts)
// 4. If execution fails, AI fixes the code (max 2 fix attempts per execution failure)
// 5. Results are shown and compared with original strategy
router.post("/start", async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: "Unauthorized. Session expired." });
    }

    const { 
      parentStrategyId, 
      optimizationPrompt, 
      optimizationGoal 
    } = req.body;

    if (!parentStrategyId || !optimizationPrompt) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Fetch parent strategy — accept both 'deep' (new) and 'research' (legacy)
    const parent = await Strategy.findOne({
      _id: parentStrategyId,
      userId: req.session.userId,
      plan: { $in: ['deep', 'research'] },
      status: "completed"
    });

    if (!parent) {
      return res.status(404).json({ 
        error: "Parent strategy not found or not eligible for optimization" 
      });
    }

    // Check optimization limit (max 3)
    const existingOptimizations = await Strategy.countDocuments({
      parentStrategyId: parent._id,
      isOptimization: true
    });

    if (existingOptimizations >= 3) {
      return res.status(400).json({ 
        error: "Maximum 3 optimizations reached for this strategy" 
      });
    }

    // Check user credits — optimization addon is +3 credits
    const user = await User.findById(req.session.userId);
    const optimizationCredits = 3;  // Addon cost on top of base DEEP credits
    
    if (user.creditTokens < optimizationCredits) {
      return res.status(400).json({ 
        error: `Insufficient credits. Need ${optimizationCredits} credits.` 
      });
    }

    // Generate optimized code via Gemini
    const model = ai.getGenerativeModel({ model: "gemini-3-flash-preview" });
    
    const optimizationContext = `
You are an expert quantitative trading strategist. Your task is to IMPROVE the existing strategy.

================================================================================
ORIGINAL STRATEGY PERFORMANCE (BASELINE TO BEAT):
================================================================================
${parent.output}

ORIGINAL STRATEGY DESCRIPTION:
${parent.prompt}

ORIGINAL CODE:
${parent.generatedCode}

================================================================================
OPTIMIZATION GOAL: ${optimizationGoal}
SPECIFIC INSTRUCTIONS: ${optimizationPrompt}
================================================================================

YOUR MISSION: Create an IMPROVED version that has BETTER metrics than the original.

CRITICAL SUCCESS CRITERIA (YOU MUST IMPROVE THESE):
- If original Total Return was positive, make it MORE positive
- If original Total Return was negative, make it LESS negative or positive
- Reduce Max Drawdown (make it closer to 0)
- Increase Win Rate if possible
- Increase Sharpe Ratio (better risk-adjusted returns)
- Increase Profit Factor (>1.0 is profitable)

OPTIMIZATION STRATEGIES TO CONSIDER:
1. ADD FILTERS: Only trade in favorable market conditions
   - Trend filters (only long in uptrend, only short in downtrend)
   - Volatility filters (avoid trading in extreme volatility)
   - Volume filters (trade only with sufficient liquidity)

2. IMPROVE ENTRY/EXIT:
   - Add confirmation signals (multiple indicators agreeing)
   - Use better entry timing (wait for pullbacks in trends)
   - Improve exit logic (trailing stops, profit targets)

3. RISK MANAGEMENT:
   - Add stop losses to limit losses per trade
   - Add take profit levels to lock in gains
   - Reduce position size in uncertain conditions

4. REDUCE OVERTRADING:
   - Add cooldown periods between trades
   - Increase signal strength requirements
   - Filter out low-probability setups

5. PARAMETER OPTIMIZATION:
   - Adjust indicator periods (e.g., EMA 50 → EMA 20 or EMA 100)
   - Adjust RSI thresholds (e.g., 50 → 55 or 45)
   - Test different combinations

WHAT NOT TO DO:
❌ Don't make the strategy more aggressive if it's already losing
❌ Don't remove all filters (this causes overtrading)
❌ Don't change the core logic completely (incremental improvements)
❌ Don't ignore the original strategy's strengths

REQUIRED OUTPUT FORMAT (MUST MATCH EXACTLY):
================================================================================
🚨 CRITICAL: The output parser is VERY STRICT. Follow this EXACTLY or code will fail! 🚨

At the end of your code, print EXACTLY this (copy-paste these lines):

print(f"\\nBACKTEST SUMMARY:")
print(f"Start Date: {df.index[0].strftime('%Y-%m-%d')}")
print(f"End Date: {df.index[-1].strftime('%Y-%m-%d')}")
print(f"Timeframe: {INTERVAL}")
print(f"Total Return (%): {total_return:.2f}")
print(f"CAGR (%): {cagr:.2f}")
print(f"Max Drawdown (%): {max_dd:.2f}")
print(f"Win Rate (%): {win_rate:.2f}")
print(f"Profit Factor: {profit_factor:.2f}")
print(f"Sharpe Ratio: {sharpe_ratio:.2f}")
print(f"Total Trades: {len(closed_trades)}")

❌ WRONG: "OPTIMIZED BACKTEST SUMMARY" or "BACKTEST SUMMARY (anything)"
✅ CORRECT: "BACKTEST SUMMARY:" (exactly, no extra words)

❌ WRONG: "Total Return: 25.50%" or "Total Return: 25.50"
✅ CORRECT: "Total Return (%): 25.50" (label has (%), value does NOT)

❌ WRONG: Skip Start Date, End Date, or Timeframe
✅ CORRECT: Include ALL 10 fields in exact order shown above

For yearly returns (optional):
print(f"\\nYEARLY RETURNS:")
for year, return_value in yearly_returns.items():
    print(f"{year}: {return_value:.2f}%")

For monthly returns (optional):
print(f"\\nMONTHLY RETURNS:")
for date, return_value in monthly_returns.items():
    print(f"{date.strftime('%b-%Y')}: {return_value:.2f}%")

For the chart (REQUIRED):
plt.savefig('equity.png', dpi=150, bbox_inches='tight')

❌ WRONG: 'equity_optimized.png' or 'equity_123.png' or any other name
✅ CORRECT: 'equity.png' (exactly this filename)

================================================================================

TECHNICAL REQUIREMENTS:
1. Use matplotlib.use('Agg') at the top
2. Track actual trades with entry/exit prices for accurate metrics
3. Calculate Profit Factor: (gross_profit / gross_loss) if gross_loss != 0 else float('inf')
4. Values should NOT have % symbol except in yearly/monthly returns
5. Save chart as 'equity.png' (will be renamed automatically)
6. Use the SAME timeframe, assets, and date range as original
7. Keep the same data loading logic (don't break Yahoo Finance compatibility)
8. 🚨 CRITICAL: Use correct pandas resample frequencies:
   - For yearly: resample('YE') NOT resample('Y') or resample('A')
   - For monthly: resample('ME') NOT resample('M')
   - For quarterly: resample('QE') NOT resample('Q')
   - ValueError "Invalid frequency" means you used old pandas syntax!

Return ONLY the complete optimized Python code. No explanations. No markdown.
START WITH 'import' STATEMENTS.
`;

    let optimizedCode = null;
    const MAX_AI_GENERATION_ATTEMPTS = 2;

    // Try generating code with AI (max 2 attempts)
    for (let genAttempt = 1; genAttempt <= MAX_AI_GENERATION_ATTEMPTS; genAttempt++) {
      try {
        console.log(`🤖 Generating optimized code - Attempt ${genAttempt}/${MAX_AI_GENERATION_ATTEMPTS}`);
        const result = await model.generateContent(optimizationContext);
        optimizedCode = result.response.text();
        
        // Clean code
        optimizedCode = optimizedCode
          .replace(/```python/gi, '')
          .replace(/```/g, '')
          .trim();

        if (!optimizedCode || optimizedCode.length < 100) {
          throw new Error("AI returned invalid or too short code");
        }

        console.log(`✓ AI code generation successful on attempt ${genAttempt}`);
        break; // Success, exit loop
      } catch (genErr) {
        console.error(`✗ AI code generation attempt ${genAttempt}/${MAX_AI_GENERATION_ATTEMPTS} failed:`, genErr.message);
        
        if (genAttempt === MAX_AI_GENERATION_ATTEMPTS) {
          throw new Error(`Failed to generate valid optimized code after ${MAX_AI_GENERATION_ATTEMPTS} attempts: ${genErr.message}`);
        }
        
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (!optimizedCode) {
      throw new Error("Failed to generate optimized code");
    }

    // Create optimization strategy document
    const optimizationStrategy = new Strategy({
      userId: req.session.userId,
      prompt: optimizationPrompt,
      generatedCode: optimizedCode,
      strategyLogic: parent.strategyLogic,
      plan: "research",
      timeframe: parent.timeframe,
      assets: parent.assets,
      indicators: parent.indicators,
      creditsUsed: optimizationCredits,
      status: "pending",
      isOptimization: true,
      parentStrategyId: parent._id,
      optimizationPrompt: optimizationPrompt,
      optimizationNumber: existingOptimizations + 1,
      optimizationGoal: optimizationGoal,
      comparisonData: {
        originalMetrics: parent.metrics,
        improvementNotes: `Optimization #${existingOptimizations + 1}: ${optimizationGoal}`
      }
    });

    await optimizationStrategy.save();

    // NOTE: Credits will be deducted ONLY after successful completion
    // See processOptimization function for credit deduction logic

    res.json({
      success: true,
      sessionId: optimizationStrategy._id.toString(),
      optimizationNumber: optimizationStrategy.optimizationNumber,
      newCredits: user.creditTokens, // Current credits (not yet deducted)
      message: "Optimization started"
    });

    processOptimization(optimizationStrategy._id, optimizedCode, parent.timeframe, req.session.userId, optimizationCredits).catch(err => console.error("Background optimization error:", err));

  } catch (err) {
    console.error("Error starting optimization:", err);
    res.status(500).json({ 
      error: err.message || "Failed to start optimization" 
    });
  }
});

// ─── GET: Get All Optimizations for Parent ───────────────────────────────────
router.get("/parent/:parentId", async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: "Unauthorized. Session expired." });
    }

    const parent = await Strategy.findOne({
      _id: req.params.parentId,
      userId: req.session.userId,
      plan: "research"
    });

    if (!parent) {
      return res.status(404).json({ error: "Parent strategy not found" });
    }

    const optimizations = await Strategy.find({
      parentStrategyId: parent._id,
      isOptimization: true,
      userId: req.session.userId
    }).sort({ optimizationNumber: 1 });

    const remainingSlots = 3 - optimizations.length;

    res.json({
      success: true,
      parent: {
        _id: parent._id,
        prompt: parent.prompt,
        metrics: parent.metrics,
        output: parent.output
      },
      optimizations: optimizations.map(opt => ({
        _id: opt._id,
        optimizationNumber: opt.optimizationNumber,
        optimizationGoal: opt.optimizationGoal,
        status: opt.status,
        metrics: opt.metrics,
        output: opt.output,
        createdAt: opt.createdAt
      })),
      remainingOptimizations: remainingSlots,
      canOptimize: remainingSlots > 0 && parent.status === "completed"
    });

  } catch (err) {
    console.error("Error fetching optimizations:", err);
    res.status(500).json({ error: "Failed to fetch optimizations" });
  }
});

function parseMetrics(output) {
  try {
    if (!output) return null;
    const lines = output.split('\n');
    const metrics = {};
    const yearlyReturns = [];
    const monthlyReturns = [];
    let mode = '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === 'BACKTEST SUMMARY:') { mode = 'summary'; continue; }
      if (trimmed === 'YEARLY RETURNS:') { mode = 'yearly'; continue; }
      if (trimmed === 'MONTHLY RETURNS:') { mode = 'monthly'; continue; }
      if (!trimmed) continue;
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex === -1) continue;
      const key = trimmed.substring(0, colonIndex).trim();
      const value = trimmed.substring(colonIndex + 1).trim();
      if (mode === 'summary') {
        metrics[key] = value;
      } else if (mode === 'yearly') {
        const val = parseFloat(value.replace('%', '')) || 0;
        yearlyReturns.push({ year: key, value: val });
      } else if (mode === 'monthly') {
        const val = parseFloat(value.replace('%', '')) || 0;
        const monthMatch = key.match(/([A-Za-z]{3})-(\d{4})/);
        if (monthMatch) {
          monthlyReturns.push({ month: monthMatch[1], year: monthMatch[2], value: val });
        }
      }
    }
    return {
      totalReturn: metrics['Total Return (%)'] || '0',
      cagr: metrics['CAGR (%)'] || '0',
      maxDrawdown: metrics['Max Drawdown (%)'] || '0',
      winRate: metrics['Win Rate (%)'] || '0',
      profitFactor: metrics['Profit Factor'] || '0',
      sharpeRatio: metrics['Sharpe Ratio'] || '0',
      totalTrades: metrics['Total Trades'] || '0',
      startDate: metrics['Start Date'] || '',
      endDate: metrics['End Date'] || '',
      timeframe: metrics['Timeframe'] || '',
      yearlyReturns,
      monthlyReturns
    };
  } catch (err) {
    console.error("Error parsing metrics:", err);
    return null;
  }
}

const YF_LIMITS = {
  '1m':  { days: 7,   note: '7 days max for 1-minute candles' },
  '5m':  { days: 60,  note: '60 days max for 5-minute candles' },
  '15m': { days: 180, note: '180 days max for 15-minute candles' },
  '30m': { days: 180, note: '180 days max for 30-minute candles' },
  '1h':  { days: 729, note: '730 days max for 1-hour candles' },
  '4h':  { days: 729, note: '730 days max for 4-hour candles' },
  '1d':  { days: 3650, note: '10+ years for daily candles' }
};

function getSafeDateRange(timeframe) {
  const now = new Date();
  const limit = YF_LIMITS[timeframe] || YF_LIMITS['1h'];
  const startDate = new Date(now.getTime() - limit.days * 24 * 60 * 60 * 1000);
  return {
    start: startDate.toISOString().split('T')[0],
    end: now.toISOString().split('T')[0],
    maxDays: limit.days,
    note: limit.note
  };
}

function cleanCode(code) {
  if (!code || typeof code !== 'string') return '';
  let cleaned = code.replace(/```python\n/gi, '').replace(/```\n/gi, '').replace(/```/g, '');
  cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u00A0/g, ' ').replace(/\r\n/g, '\n').replace(/\t/g, '    ');
  const importMatch = cleaned.match(/^(.*?)(^import\s|^from\s)/ms);
  if (importMatch && importMatch[1].trim() && !importMatch[1].includes('def ') && !importMatch[1].includes('class ')) {
    cleaned = cleaned.substring(importMatch[1].length);
  }
  const firstImport = cleaned.search(/^import\s|^from\s/m);
  if (firstImport !== -1) cleaned = cleaned.substring(firstImport);
  return cleaned.trim();
}

async function fixCode(oldCode, error, timeframe) {
  const dateRange = getSafeDateRange(timeframe);
  const fixPrompt = `
================================================================================
PYTHON DEBUGGING EXPERT - FIX YAHOO FINANCE ERRORS
================================================================================

OUTPUT RULES:
1. Output ONLY corrected Python code
2. NO markdown backticks
3. NO explanations
4. START with 'import' statements
5. PRESERVE indentation

================================================================================
ERROR TO FIX:
================================================================================
${error}

================================================================================
CODE TO FIX:
================================================================================
${oldCode}

================================================================================
YAHOO FINANCE LIMITS FOR ${timeframe}:
================================================================================
- Maximum days of data: ${dateRange.maxDays} days
- Safe start date: ${dateRange.start}
- End date: ${dateRange.end} (today)

================================================================================
CRITICAL: IF ERROR MENTIONS DATE RANGE OR "data not available":
================================================================================
- Recalculate start_date = datetime.now() - timedelta(days=${dateRange.maxDays - 1})
- Add date validation before yf.download()
- Print warning if user-requested range exceeds limits

================================================================================
CRITICAL: IF ERROR MENTIONS "Invalid frequency" OR "ValueError":
================================================================================
🚨 This means you're using OLD pandas resample syntax! Fix it:
❌ WRONG: df.resample('Y') or df.resample('A') or df.resample('M') or df.resample('Q')
✅ CORRECT: df.resample('YE') for yearly, df.resample('ME') for monthly, df.resample('QE') for quarterly

Example fix:
# OLD (causes error):
yearly_df = df['Equity'].resample('Y').last()
# NEW (correct):
yearly_df = df['Equity'].resample('YE').last()

================================================================================
CRITICAL OUTPUT FORMAT (MUST MATCH EXACTLY - NO DEVIATIONS ALLOWED):
================================================================================
🚨 The parser is VERY STRICT. Use EXACTLY these print statements: 🚨

print(f"\\nBACKTEST SUMMARY:")
print(f"Start Date: {df.index[0].strftime('%Y-%m-%d')}")
print(f"End Date: {df.index[-1].strftime('%Y-%m-%d')}")
print(f"Timeframe: {INTERVAL}")
print(f"Total Return (%): {total_return:.2f}")
print(f"CAGR (%): {cagr:.2f}")
print(f"Max Drawdown (%): {max_dd:.2f}")
print(f"Win Rate (%): {win_rate:.2f}")
print(f"Profit Factor: {profit_factor:.2f}")
print(f"Sharpe Ratio: {sharpe_ratio:.2f}")
print(f"Total Trades: {len(closed_trades)}")

❌ DO NOT write: "OPTIMIZED BACKTEST SUMMARY" or add any extra words
✅ MUST write: "BACKTEST SUMMARY:" exactly as shown

❌ DO NOT write: "Total Return: 25.50%" (wrong label and format)
✅ MUST write: "Total Return (%): 25.50" (label has (%), value does NOT have %)

For yearly: print(f"{year}: {return_value:.2f}%")
For monthly: print(f"{date.strftime('%b-%Y')}: {return_value:.2f}%")
Save chart: plt.savefig('equity.png', dpi=150, bbox_inches='tight')

OUTPUT ONLY THE FIXED CODE. START WITH 'import'.
================================================================================
`;
  const model = ai.getGenerativeModel({ model: "gemini-3-flash-preview" });
  const result = await model.generateContent(fixPrompt);
  return cleanCode(result.response.text());
}

async function processOptimization(strategyId, initialCode, timeframe, userId, creditsToDeduct) {
  try {
    await Strategy.findByIdAndUpdate(strategyId, { status: "running" });
    const tempDir = path.join(__dirname, "../temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    let code = initialCode;
    const MAX_EXECUTION_ATTEMPTS = 3;
    const MAX_AI_FIX_ATTEMPTS = 2; // Max 2 AI fix attempts per execution failure

    for (let attempt = 1; attempt <= MAX_EXECUTION_ATTEMPTS; attempt++) {
      let currentCode = code;
      let executionError = null;

      // Try executing the code
      try {
        const safeCode = currentCode.replace(/equity\.png/g, `equity_${strategyId}.png`);
        const filePath = path.join(tempDir, `opt_${strategyId}.py`);
        fs.writeFileSync(filePath, safeCode, 'utf-8');

        const output = await runPython(filePath);
        
        // Validate output contains required metrics
        if (!output.includes('BACKTEST SUMMARY:') || !output.includes('Total Return (%)')) {
          throw new Error('Output missing required metrics. Code may have crashed or printed wrong format.');
        }
        
        const parsed = parseMetrics(output);
        
        // Additional validation: check if metrics were actually parsed
        if (!parsed || parsed.totalReturn === '0' && parsed.cagr === '0' && parsed.sharpeRatio === '0') {
          console.warn(`⚠ Optimization ${strategyId} - Metrics parsed but all zeros, output may be incomplete`);
        }
        
        // Fetch parent strategy to compare results
        const parentStrategy = await Strategy.findOne({ _id: (await Strategy.findById(strategyId)).parentStrategyId });
        
        if (parentStrategy && parentStrategy.metrics && parsed) {
          const originalReturn = parseFloat(parentStrategy.metrics.get('Total Return (%)')) || 0;
          const optimizedReturn = parseFloat(parsed.totalReturn) || 0;
          const originalDrawdown = parseFloat(parentStrategy.metrics.get('Max Drawdown (%)')) || 0;
          const optimizedDrawdown = parseFloat(parsed.maxDrawdown) || 0;
          const originalSharpe = parseFloat(parentStrategy.metrics.get('Sharpe Ratio')) || 0;
          const optimizedSharpe = parseFloat(parsed.sharpeRatio) || 0;
          
          // Calculate improvement
          const returnImprovement = optimizedReturn - originalReturn;
          const drawdownImprovement = optimizedDrawdown - originalDrawdown; // Negative is better (less drawdown)
          const sharpeImprovement = optimizedSharpe - originalSharpe;
          
          console.log(`📊 Optimization ${strategyId} - Performance Comparison:`);
          console.log(`   Total Return: ${originalReturn.toFixed(2)}% → ${optimizedReturn.toFixed(2)}% (${returnImprovement > 0 ? '+' : ''}${returnImprovement.toFixed(2)}%)`);
          console.log(`   Max Drawdown: ${originalDrawdown.toFixed(2)}% → ${optimizedDrawdown.toFixed(2)}% (${drawdownImprovement > 0 ? 'worse' : 'better'})`);
          console.log(`   Sharpe Ratio: ${originalSharpe.toFixed(2)} → ${optimizedSharpe.toFixed(2)} (${sharpeImprovement > 0 ? '+' : ''}${sharpeImprovement.toFixed(2)})`);
          
          // Check if optimization made things worse
          if (returnImprovement < -5 && drawdownImprovement > 5 && sharpeImprovement < -0.2) {
            console.warn(`⚠️ Optimization ${strategyId} - Results are WORSE than original. Consider this a failed optimization attempt.`);
          } else if (returnImprovement > 0 || sharpeImprovement > 0 || drawdownImprovement < -2) {
            console.log(`✅ Optimization ${strategyId} - Strategy improved!`);
          }
        }
        
        const updateData = { status: "completed", output: output, attempt };

        if (parsed) {
          updateData.metrics = {
            totalReturn: parsed.totalReturn, cagr: parsed.cagr,
            maxDrawdown: parsed.maxDrawdown, winRate: parsed.winRate,
            profitFactor: parsed.profitFactor, sharpeRatio: parsed.sharpeRatio,
            totalTrades: parsed.totalTrades, startDate: parsed.startDate,
            endDate: parsed.endDate
          };
          updateData.yearlyReturns = parsed.yearlyReturns || [];
          updateData.monthlyReturns = parsed.monthlyReturns || [];
        }
        if (attempt > 1) updateData.generatedCode = currentCode;
        
        await Strategy.findByIdAndUpdate(strategyId, updateData);
        
        // ✅ DEDUCT CREDITS ONLY AFTER SUCCESSFUL COMPLETION
        if (userId && creditsToDeduct) {
          try {
            const user = await User.findById(userId);
            if (user) {
              user.creditTokens -= creditsToDeduct;
              await user.save();
              console.log(`💰 Optimization ${strategyId} - Deducted ${creditsToDeduct} credits from user ${userId}`);
            }
          } catch (creditErr) {
            console.error(`⚠️ Optimization ${strategyId} - Failed to deduct credits:`, creditErr.message);
            // Don't fail the optimization if credit deduction fails
          }
        }
        
        console.log(`✓ Optimization ${strategyId} completed successfully on execution attempt ${attempt}`);
        return;
      } catch (err) {
        executionError = err;
        const errorText = err.toString();
        console.error(`✗ Optimization ${strategyId} - Execution attempt ${attempt}/${MAX_EXECUTION_ATTEMPTS} failed:`, errorText.split('\n')[0]);
      }

      // If execution failed and we have attempts left, try AI fixes
      if (executionError && attempt < MAX_EXECUTION_ATTEMPTS) {
        let fixedCode = currentCode;
        let fixSucceeded = false;

        for (let fixAttempt = 1; fixAttempt <= MAX_AI_FIX_ATTEMPTS; fixAttempt++) {
          try {
            console.log(`🤖 Optimization ${strategyId} - AI fix attempt ${fixAttempt}/${MAX_AI_FIX_ATTEMPTS}...`);
            fixedCode = await fixCode(fixedCode, executionError.toString(), timeframe || '1h');
            
            // Validate the fixed code
            if (!fixedCode || fixedCode.length < 100) {
              throw new Error("AI returned invalid or too short code");
            }

            console.log(`✓ Optimization ${strategyId} - AI fix attempt ${fixAttempt} generated new code`);
            code = fixedCode; // Update code for next execution attempt
            fixSucceeded = true;
            break; // Exit fix loop, try executing the fixed code
          } catch (fixErr) {
            console.error(`✗ Optimization ${strategyId} - AI fix attempt ${fixAttempt}/${MAX_AI_FIX_ATTEMPTS} failed:`, fixErr.message);
            
            if (fixAttempt === MAX_AI_FIX_ATTEMPTS) {
              console.error(`✗ Optimization ${strategyId} - All AI fix attempts exhausted for execution attempt ${attempt}`);
              // Continue to next execution attempt with original code
            }
          }
        }

        if (!fixSucceeded) {
          console.log(`⚠ Optimization ${strategyId} - No successful AI fix, will retry execution with current code`);
        }
      } else if (executionError && attempt === MAX_EXECUTION_ATTEMPTS) {
        // Final attempt failed
        throw executionError;
      }
    }
  } catch (err) {
    console.error(`✗ Optimization ${strategyId} failed after all attempts:`, err.message);
    await Strategy.findByIdAndUpdate(strategyId, { 
      status: "failed", 
      output: `Optimization failed after multiple attempts:\n\n${err.toString()}\n\nPlease try a different optimization approach or contact support.` 
    });
  }
}

module.exports = router;