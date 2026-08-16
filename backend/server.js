const express = require('express');
const cors = require('cors');
const { Pool } = require('pg'); 
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend'))); 

// ==========================================
// DATABASE CONNECTION
// ==========================================
const pool = new Pool({
    connectionString: 'postgresql://postgres.esrzbgxvchocvfdxyxqp:NeerajKartik%402026@aws-1-ap-south-1.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false } 
});

pool.connect((err, client, release) => {
    if (err) {
        console.error('Database connection failed:', err.stack);
    } else {
        console.log('Successfully connected to the Supabase Cloud Database!');
        release();
    }
});

// ==========================================
// EMAIL TRANSPORTER CONFIGURATION
// ==========================================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'chityaacademy@gmail.com', 
        pass: 'cvfqnjpsaplcltbw' 
    }
});

// ==========================================
// STUDENT AUTHENTICATION & REGISTRATION
// ==========================================
app.post('/api/register', async (req, res) => {
    try {
        const { full_name, email, phone_number, password, target_class } = req.body;

        const existingUser = await pool.query("SELECT * FROM Users WHERE email = $1", [email]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: "That email is already registered." });
        }

        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);
        const verificationToken = crypto.randomBytes(32).toString('hex');

        await pool.query(
            "INSERT INTO Users (full_name, email, phone_number, password_hash, target_class, is_verified, verification_token, is_premium) VALUES ($1, $2, $3, $4, $5, false, $6, false)",
            [full_name, email, phone_number, password_hash, target_class, verificationToken]
        );

        const verificationUrl = `http://localhost:3000/api/verify?token=${verificationToken}`;
        
        await transporter.sendMail({
            from: '"Chitya Academy" <chityaacademy@gmail.com>',
            to: email,
            subject: 'Verify Your Chitya Academy Account',
            html: `
                <h2>Welcome to Chitya Academy, ${full_name}!</h2>
                <p>Please click the link below to verify your email address:</p>
                <a href="${verificationUrl}" style="background-color: #0b1c3c; color: #fdd017; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Verify Email Now</a>
            `
        });

        res.json({ message: "Registration successful! Please check your email inbox to verify your account." });
        
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Server error during registration." });
    }
});

app.get('/api/verify', async (req, res) => {
    try {
        const { token } = req.query;
        const userResult = await pool.query("SELECT * FROM Users WHERE verification_token = $1", [token]);

        if (userResult.rows.length === 0) {
            return res.status(400).send("<h3>Invalid or expired verification link.</h3>");
        }

        await pool.query("UPDATE Users SET is_verified = true, verification_token = NULL WHERE verification_token = $1", [token]);

        res.send(`
            <div style="text-align: center; font-family: sans-serif; margin-top: 50px;">
                <h1 style="color: #10b981;">Email Verified Successfully!</h1>
                <p>Your Chitya Academy account is now active.</p>
                <a href="/login.html" style="background-color: #0b1c3c; color: #fdd017; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Proceed to Login</a>
            </div>
        `);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("<h3>Server error during verification.</h3>");
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const userResult = await pool.query("SELECT * FROM Users WHERE email = $1", [email]);
        
        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: "Invalid email or password." });
        }

        const student = userResult.rows[0];

        if (!student.is_verified) {
            return res.status(401).json({ error: "Please verify your email via your inbox before logging in." });
        }

        const isMatch = await bcrypt.compare(password, student.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: "Invalid email or password." });
        }

        res.json({ 
            message: "Login successful! Welcome back.", 
            student: {
                id: student.id,
                full_name: student.full_name,
                email: student.email,
                target_class: student.target_class,
                is_premium: student.is_premium
            } 
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Server error during login." });
    }
});

// ==========================================
// PASSWORD RESET ROUTES
// ==========================================
app.post('/api/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const userResult = await pool.query("SELECT * FROM Users WHERE email = $1", [email]);

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: "No account found with that email address." });
        }

        const user = userResult.rows[0];
        const resetToken = crypto.randomBytes(32).toString('hex');
        const expiryTime = new Date(Date.now() + 3600000); 

        await pool.query(
            "UPDATE Users SET reset_token = $1, reset_token_expiry = $2 WHERE id = $3",
            [resetToken, expiryTime, user.id]
        );

        const resetUrl = `http://localhost:3000/reset-password.html?token=${resetToken}`;

        await transporter.sendMail({
            from: '"Chitya Academy" <chityaacademy@gmail.com>',
            to: email,
            subject: 'Password Reset Request - Chitya Academy',
            html: `
                <h2>Password Reset Request</h2>
                <p>Hello ${user.full_name},</p>
                <p>You requested to reset your password. Click the link below to set a new password. This link expires in 1 hour:</p>
                <a href="${resetUrl}" style="background-color: #0b1c3c; color: #fdd017; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Reset Password</a>
            `
        });

        res.json({ message: "Password reset instructions have been sent to your email." });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Server error during password reset request." });
    }
});

app.post('/api/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        const userResult = await pool.query(
            "SELECT * FROM Users WHERE reset_token = $1 AND reset_token_expiry > NOW()",
            [token]
        );

        if (userResult.rows.length === 0) {
            return res.status(400).json({ error: "Invalid or expired password reset token." });
        }

        const user = userResult.rows[0];
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        await pool.query(
            "UPDATE Users SET password_hash = $1, reset_token = NULL, reset_token_expiry = NULL WHERE id = $2",
            [hashedPassword, user.id]
        );

        res.json({ message: "Password has been successfully updated. You can now log in." });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Server error while resetting password." });
    }
});

// ==========================================
// ADMIN AUTHENTICATION
// ==========================================
app.post('/api/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const ADMIN_USER = "chityaadmin";
        const ADMIN_PASS = "NeerajKartik@2026";

        if (username === ADMIN_USER && password === ADMIN_PASS) {
            res.json({ message: "Admin login successful!", token: "chitya_secure_admin_session_token_2026" });
        } else {
            res.status(401).json({ error: "Invalid admin credentials." });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Server error during admin login." });
    }
});

// ==========================================
// ADMIN CONTROL PANEL API ROUTES
// ==========================================
app.get('/api/admin/students', async (req, res) => {
    try {
        const studentsResult = await pool.query("SELECT id, full_name, email, phone_number, target_class, is_verified, is_premium FROM Users ORDER BY id DESC");
        res.json({ students: studentsResult.rows });
    } catch (err) {
        res.status(500).json({ error: "Server error while fetching students." });
    }
});

app.post('/api/admin/upgrade/:id', async (req, res) => {
    try {
        await pool.query("UPDATE Users SET is_premium = true WHERE id = $1", [req.params.id]);
        res.json({ message: "Student upgraded to Premium!" });
    } catch (err) {
        res.status(500).json({ error: "Server error." });
    }
});

app.post('/api/admin/downgrade/:id', async (req, res) => {
    try {
        await pool.query("UPDATE Users SET is_premium = false WHERE id = $1", [req.params.id]);
        res.json({ message: "Student downgraded to Free Lead." });
    } catch (err) {
        res.status(500).json({ error: "Server error." });
    }
});

app.post('/api/upload', async (req, res) => {
    try {
        const { title, subject, target_class, is_premium, file_path } = req.body;
        await pool.query(
            "INSERT INTO Study_Materials (title, subject, target_class, is_premium, file_path) VALUES ($1, $2, $3, $4, $5)",
            [title, subject, target_class, is_premium, file_path]
        );
        res.json({ message: "Study material published!" });
    } catch (err) {
        res.status(500).json({ error: "Server error." });
    }
});

app.post('/api/admin/notice', async (req, res) => {
    try {
        const { title, content } = req.body;
        await pool.query("INSERT INTO Notices (title, content) VALUES ($1, $2)", [title, content]);
        res.json({ message: "Notice broadcasted successfully!" });
    } catch (err) {
        res.status(500).json({ error: "Server error." });
    }
});

app.delete('/api/admin/notice/:id', async (req, res) => {
    try {
        await pool.query("DELETE FROM Notices WHERE id = $1", [req.params.id]);
        res.json({ message: "Notice deleted!" });
    } catch (err) {
        res.status(500).json({ error: "Server error." });
    }
});

app.put('/api/admin/notice/:id', async (req, res) => {
    try {
        const { title, content } = req.body;
        await pool.query("UPDATE Notices SET title = $1, content = $2 WHERE id = $3", [title, content, req.params.id]);
        res.json({ message: "Notice updated!" });
    } catch (err) {
        res.status(500).json({ error: "Server error." });
    }
});

// ==========================================
// TEST SERIES & PROGRESS API ROUTES
// ==========================================
app.get('/api/tests/:class_level', async (req, res) => {
    try {
        const classLevel = req.params.class_level;
        const testsResult = await pool.query(
            "SELECT id, title, subject, target_class, questions FROM Tests WHERE target_class = $1 ORDER BY id DESC", 
            [classLevel]
        );
        res.json({ tests: testsResult.rows });
    } catch (err) {
        res.status(500).json({ error: "Server error while fetching tests." });
    }
});

app.post('/api/tests/submit', async (req, res) => {
    try {
        const { student_id, test_id, score, total_marks } = req.body;
        await pool.query(
            "INSERT INTO Test_Results (student_id, test_id, score, total_marks) VALUES ($1, $2, $3, $4)",
            [student_id, test_id, score, total_marks]
        );
        res.json({ message: "Test submitted successfully!" });
    } catch (err) {
        res.status(500).json({ error: "Server error while saving test result." });
    }
});

app.post('/api/admin/test', async (req, res) => {
    try {
        const { title, subject, target_class, questions } = req.body;
        await pool.query(
            "INSERT INTO Tests (title, subject, target_class, questions) VALUES ($1, $2, $3, $4)",
            [title, subject, target_class, JSON.stringify(questions)]
        );
        res.json({ message: "Test published successfully!" });
    } catch (err) {
        res.status(500).json({ error: "Server error while publishing test." });
    }
});

// Fetch a student's past test results for their Profile
app.get('/api/progress/:student_id', async (req, res) => {
    try {
        const studentId = req.params.student_id;
        const result = await pool.query(
            `SELECT tr.score, tr.total_marks, tr.submitted_at, t.title, t.subject 
             FROM Test_Results tr 
             JOIN Tests t ON tr.test_id = t.id 
             WHERE tr.student_id = $1 
             ORDER BY tr.submitted_at DESC`,
            [studentId]
        );
        res.json({ history: result.rows });
    } catch (err) {
        res.status(500).json({ error: "Server error while fetching progress." });
    }
});

// Fetch all student test results for the Admin Panel
app.get('/api/admin/results', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT tr.id, tr.score, tr.total_marks, tr.submitted_at, 
                    u.full_name, u.target_class, 
                    t.title, t.subject 
             FROM Test_Results tr 
             JOIN Users u ON tr.student_id = u.id
             JOIN Tests t ON tr.test_id = t.id 
             ORDER BY tr.submitted_at DESC`
        );
        res.json({ results: result.rows });
    } catch (err) {
        res.status(500).json({ error: "Server error while fetching all results." });
    }
});

// ==========================================
// STUDENT DASHBOARD API ROUTES
// ==========================================
app.get('/api/materials/:class_level', async (req, res) => {
    try {
        const classLevel = req.params.class_level;
        const materialsResult = await pool.query(
            "SELECT id, title, subject, file_path, is_premium FROM Study_Materials WHERE target_class = $1 ORDER BY id DESC", 
            [classLevel]
        );
        res.json({ materials: materialsResult.rows });
    } catch (err) {
        res.status(500).json({ error: "Server error while fetching study materials." });
    }
});

app.get('/api/notices', async (req, res) => {
    try {
        const noticesResult = await pool.query("SELECT * FROM Notices ORDER BY id DESC LIMIT 5");
        res.json({ notices: noticesResult.rows });
    } catch (err) {
        res.status(500).json({ error: "Server-side error while fetching notices." });
    }
});

// ==========================================
// DATABASE KEEP-ALIVE PING ROUTE
// ==========================================
app.get('/api/health', async (req, res) => {
    try {
        // This tiny query forces Supabase to register activity
        await pool.query('SELECT 1'); 
        res.status(200).send("Chitya Academy Server and Database are wide awake!");
    } catch (err) {
        console.error("Health check failed:", err.message);
        res.status(500).send("Database connection error.");
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Chitya Academy Backend is running on http://localhost:${PORT}`);
});