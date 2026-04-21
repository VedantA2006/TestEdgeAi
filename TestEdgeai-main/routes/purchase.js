// routes/purchase.js
const express = require("express");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const Transaction = require("../models/Transaction");
const User = require("../models/User");

const router = express.Router();

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ─── PACKAGE CONFIGURATION ───────────────────────────────────────────────────
// In routes/purchase.js, the PACKAGES object should use these keys:
const PACKAGES = {
  quick: {   // ✅ Must match enum value
    name: "Quick Credits",
    credits: 50,
    price: 499,
    // ...
  },
  smart: {   // ✅ Must match enum value
    name: "Smart Credits", 
    credits: 200,
    price: 1499,
    // ...
  },
  research: {   // ✅ Must match enum value
    name: "Research Credits",
    credits: 500,
    price: 2999,
    // ...
  }
};

// ─── GET: Purchase Page ──────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.redirect("/auth/login");
    }

    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.redirect("/auth/login");
    }

    res.render("purchase", {
      user,
      packages: PACKAGES
    });
  } catch (err) {
    console.error("Error loading purchase page:", err);
    res.redirect("/dashboard");
  }
});

// ─── POST: Create Razorpay Order ─────────────────────────────────────────────
router.post("/create-order", async (req, res) => {
  try {
    console.log("📥 Create order request:", req.body);
    console.log("📥 Session userId:", req.session.userId);
    
    // Check authentication
    if (!req.session.userId) {
      console.error("❌ No user session");
      return res.status(401).json({ error: "Please login to purchase credits" });
    }

    const { package: pkgKey } = req.body;
    
    // Validate package
    if (!pkgKey || !PACKAGES[pkgKey]) {
      console.error("❌ Invalid package:", pkgKey);
      return res.status(400).json({ 
        error: "Invalid package selected",
        availablePackages: Object.keys(PACKAGES)
      });
    }

    const user = await User.findById(req.session.userId);
    if (!user) {
      console.error("❌ User not found:", req.session.userId);
      return res.status(404).json({ error: "User not found" });
    }

    const pkg = PACKAGES[pkgKey];
    const amount = pkg.price * 100; // Razorpay expects amount in paise

    console.log(`✅ Creating order for user ${user._id} | Package: ${pkgKey} | Amount: ₹${pkg.price}`);

    // Create Razorpay Order
    const options = {
      amount: amount,
      currency: "INR",
      receipt: `receipt_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      notes: {
        userId: user._id.toString(),
        package: pkgKey,
        credits: pkg.credits,
        username: user.username,
        email: user.email
      }
    };

    const order = await razorpay.orders.create(options);

    // Create Transaction Record
    const transaction = new Transaction({
      userId: user._id,
      razorpayOrderId: order.id,
      amount: pkg.price,
      currency: "INR",
      credits: pkg.credits,
      package: pkgKey,
      status: "pending",
      metadata: {
        email: user.email,
        username: user.username,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get("user-agent")
      }
    });

    await transaction.save();

    console.log(`✅ Order created: ${order.id} for user ${user._id}`);

    res.json({
      success: true,
      order: {
        id: order.id,
        amount: amount,
        currency: "INR",
        key_id: process.env.RAZORPAY_KEY_ID,
        name: "QuantAI Studio",
        description: `Purchase ${pkg.credits} Credits - ${pkg.name}`,
        prefill: {
          name: user.username,
          email: user.email,
          contact: ""
        },
        package: pkgKey,
        credits: pkg.credits
      }
    });
  } catch (err) {
    console.error("❌ Error creating order:", err);
    console.error("❌ Error stack:", err.stack);
    res.status(500).json({
      success: false,
      error: err.message || "Failed to create payment order",
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// ─── POST: Verify Payment ────────────────────────────────────────────────────
router.post("/verify", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, package: pkgKey } = req.body;

    console.log("📥 Verify payment:", { razorpay_order_id, razorpay_payment_id, pkgKey });

    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Verify Signature
    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest("hex");

    console.log("🔐 Signature verification:", razorpay_signature === expectedSign);

    if (razorpay_signature !== expectedSign) {
      console.error("❌ Payment signature verification failed");
      return res.status(400).json({
        success: false,
        error: "Invalid payment signature"
      });
    }

    // Find and Update Transaction
    const transaction = await Transaction.findOne({
      razorpayOrderId: razorpay_order_id,
      userId: user._id
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: "Transaction not found"
      });
    }

    // Update Transaction
    transaction.razorpayPaymentId = razorpay_payment_id;
    transaction.razorpaySignature = razorpay_signature;
    transaction.status = "completed";
    transaction.razorpayResponse = req.body;
    transaction.updatedAt = new Date();
    await transaction.save();

    // Add Credits to User
    user.creditTokens += transaction.credits;
    await user.save();

    console.log(`✅ Payment verified: ${razorpay_payment_id} | Credits added: ${transaction.credits}`);

    res.json({
      success: true,
      message: "Payment successful",
      credits: transaction.credits,
      newBalance: user.creditTokens,
      transactionId: transaction._id
    });
  } catch (err) {
    console.error("❌ Error verifying payment:", err);
    res.status(500).json({
      success: false,
      error: err.message || "Payment verification failed"
    });
  }
});

// ─── POST: Webhook Handler ───────────────────────────────────────────────────
router.post("/webhook", async (req, res) => {
  try {
    const webhookSignature = req.get("X-Razorpay-Signature");
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    // For localhost testing, skip signature verification
    const isLocalhost = req.hostname === 'localhost' || req.ip === '127.0.0.1' || req.ip === '::1';
    
    if (!isLocalhost && webhookSecret) {
      const expectedSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(JSON.stringify(req.body))
        .digest("hex");

      if (webhookSignature !== expectedSignature) {
        console.error("❌ Webhook signature verification failed");
        return res.status(400).json({ error: "Invalid webhook signature" });
      }
    }

    const event = req.body;
    console.log("📥 Webhook received:", event.event);

    switch (event.event) {
      case "payment.captured": {
        const payment = event.payload.payment.entity;
        const orderId = payment.order_id;
        const paymentId = payment.id;

        const transaction = await Transaction.findOne({ razorpayOrderId: orderId });

        if (transaction && transaction.status === "pending") {
          transaction.razorpayPaymentId = paymentId;
          transaction.status = "completed";
          transaction.razorpayResponse = payment;
          transaction.updatedAt = new Date();
          await transaction.save();

          const user = await User.findById(transaction.userId);
          if (user) {
            user.creditTokens += transaction.credits;
            await user.save();
            console.log(`✅ Webhook: Credits added to user ${user._id}`);
          }
        }
        break;
      }

      case "payment.failed": {
        const payment = event.payload.payment.entity;
        const orderId = payment.order_id;

        const transaction = await Transaction.findOne({ razorpayOrderId: orderId });

        if (transaction) {
          transaction.status = "failed";
          transaction.razorpayResponse = payment;
          transaction.updatedAt = new Date();
          await transaction.save();
        }
        break;
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error processing webhook:", err);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

// ─── GET: Success Page ───────────────────────────────────────────────────────
router.get("/success", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.redirect("/auth/login");
    }

    const { transaction_id, credits } = req.query;
    const user = await User.findById(req.session.userId);

    if (!user) {
      return res.redirect("/auth/login");
    }

    let transaction = null;
    if (transaction_id) {
      transaction = await Transaction.findOne({
        _id: transaction_id,
        userId: user._id
      });
    }

    res.render("purchase-success", {
      user,
      transaction,
      credits: credits || (transaction ? transaction.credits : 0)
    });
  } catch (err) {
    console.error("Error loading success page:", err);
    res.redirect("/dashboard");
  }
});

// ─── GET: Failed Page ────────────────────────────────────────────────────────
router.get("/failed", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.redirect("/auth/login");
    }

    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.redirect("/auth/login");
    }

    res.render("purchase-failed", { user });
  } catch (err) {
    console.error("Error loading failed page:", err);
    res.redirect("/dashboard");
  }
});

module.exports = router;