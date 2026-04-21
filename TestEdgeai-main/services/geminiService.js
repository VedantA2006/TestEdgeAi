// services/geminiService.js
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function generateOptimizedCode(context) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
    
    const optimizationPrompt = `
You are an expert quantitative trading strategist. Optimize this trading strategy:

=== ORIGINAL STRATEGY ===
${context.originalPrompt}

=== ORIGINAL CODE ===
${context.originalCode}

=== ORIGINAL RESULTS ===
${context.originalResults}

=== OPTIMIZATION GOAL ===
${context.optimizationGoal}

=== INSTRUCTIONS ===
${context.optimizationPrompt}

Return ONLY the optimized Python code. No explanations.
`;
    
    const result = await model.generateContent(optimizationPrompt);
    const response = await result.response;
    let code = response.text();
    
    // Extract code from markdown if present
    const codeMatch = code.match(/```python\s*([\s\S]*?)```/);
    if (codeMatch) {
      code = codeMatch[1].trim();
    }
    
    return code;
  } catch (err) {
    console.error("Error generating optimized code:", err);
    throw new Error(`AI optimization failed: ${err.message}`);
  }
}

module.exports = { generateOptimizedCode };