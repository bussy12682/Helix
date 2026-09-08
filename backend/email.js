import nodemailer from 'nodemailer';

let transporter = null;

function initializeEmailService(config) {
  // Check if we should use a real email service or demo mode
  if (config.emailProvider === 'smtp' && config.smtpHost && config.smtpUser && config.smtpPass) {
    transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort || 587,
      secure: config.smtpSecure || false,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass,
      },
    });
  } else if (config.emailProvider === 'sendgrid' && config.sendgridApiKey) {
    // SendGrid via nodemailer
    transporter = nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      auth: {
        user: 'apikey',
        pass: config.sendgridApiKey,
      },
    });
  } else {
    // Demo mode: log emails to console
    transporter = {
      sendMail: async (options) => {
        console.log('📧 [DEMO EMAIL MODE] Email would be sent:');
        console.log(`   To: ${options.to}`);
        console.log(`   Subject: ${options.subject}`);
        console.log(`   Body: ${options.html}`);
        return { messageId: `demo_${Date.now()}` };
      },
    };
  }
}

async function sendVerificationEmail(email, token, baseUrl = 'http://localhost:8080') {
  if (!transporter) {
    throw new Error('Email service not initialized');
  }

  const verificationUrl = `${baseUrl}/verify-email?token=${token}&email=${encodeURIComponent(email)}`;
  const htmlContent = `
    <h2>Welcome to HELIX!</h2>
    <p>Thank you for creating an account. Please verify your email to get started.</p>
    <p><a href="${verificationUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Verify Email</a></p>
    <p>Or paste this token: <code>${token}</code></p>
    <p>This link expires in 24 hours.</p>
  `;

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'noreply@helix.app',
      to: email,
      subject: 'Verify your HELIX email',
      html: htmlContent,
    });
    return true;
  } catch (error) {
    console.error('Failed to send verification email:', error);
    throw error;
  }
}

async function sendPasswordResetEmail(email, token, baseUrl = 'http://localhost:8080') {
  if (!transporter) {
    throw new Error('Email service not initialized');
  }

  const resetUrl = `${baseUrl}/forgot-password?token=${token}`;
  const htmlContent = `
    <h2>Password Reset Request</h2>
    <p>You requested to reset your password for your HELIX account.</p>
    <p><a href="${resetUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Password</a></p>
    <p>Or paste this token: <code>${token}</code></p>
    <p>This link expires in 1 hour. If you didn't request this, please ignore this email.</p>
  `;

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'noreply@helix.app',
      to: email,
      subject: 'Reset your HELIX password',
      html: htmlContent,
    });
    return true;
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    throw error;
  }
}

export { initializeEmailService, sendVerificationEmail, sendPasswordResetEmail };
