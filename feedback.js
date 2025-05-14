import mysql from "mysql2/promise";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import fs from "fs";
import session from "express-session";
import dbconfig from "./dbconfig.json"with { type: "json" };
import bcrypt from "bcrypt";
//const dbconfig = JSON.parse(fs.readFileSync("./dbconfig.json", "utf8"));
const app = express();
const PORT = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pool = mysql.createPool(dbconfig);

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "includes")));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded());
app.set("view engine", "ejs");

app.use(
  session({
    secret: "your_secret_key",
    resave: false,
    saveUninitialized: true,
  })
);

const requireLogin = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect("/");
  }
  next();
};

app.get("/", (req, res) => {
  if (req.session.user) {
    return res.redirect("/feedback");
  }
  res.render("index.ejs", { user: req.session.user });
});

app.post("/login", async (req, res) => {
  const { identifier, password } = req.body;
  //debug
  console.log("Identifier:", identifier);
  console.log("Password:", password);

  const sql = `
    SELECT * FROM system_user 
    WHERE id = ? OR email = ?`;

  const [results] = await pool.execute(sql, [identifier, identifier]);

  console.log("Results:", results);

  if (results.length > 0) {
    const user = results[0];

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (passwordMatch) {
      req.session.user = { id: user.id, username: user.fullname };
      return res.redirect("/feedback");
    } else {
      return res.render("index.ejs", { message: "Invalid password" });
    }
  } else {
    return res.render("index.ejs", { message: "Login not successful" });
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) throw err;
    res.redirect("/");
  });
});

app.get("/customers", requireLogin, async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [customers] = await connection.execute(`
      SELECT system_user.id, system_user.fullname AS name, system_user.email, customer.name AS company
      FROM system_user
      LEFT JOIN customer ON system_user.customer_id = customer.id
    `);

    res.render("customers.ejs", { customers });
  } catch (err) {
    console.error("Error fetching customers:", err);
    res.status(500).send("Internal Server Error");
  } finally {
    if (connection) {
      await connection.release();
    }
  }
});

app.get("/feedback", requireLogin, async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [feedbackRows] = await connection.execute(`
    SELECT 
      f.id, 
      DATE_FORMAT(f.arrived, '%Y-%m-%d %H:%i:%s') AS arrived,
      IFNULL(u.fullname, f.guest_name) AS name, 
      f.feedback
    FROM 
        feedback AS f
    LEFT JOIN 
        system_user AS u ON f.from_user = u.id
    ORDER BY 
        f.arrived DESC
    `);

    res.render("feedback.ejs", {
      feedback: feedbackRows,
      user: req.session.user,
    });
  } catch (err) {
    console.error("Error fetching feedback:", err);
    res.status(500).send("Internal Server Error");
  } finally {
    if (connection) {
      await connection.release();
    }
  }
});

app.get("/tickets", requireLogin, async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [tickets] = await connection.execute(`
    SELECT 
        st.id, 
        DATE_FORMAT(st.arrived, '%Y-%m-%d %H:%i:%s') AS arrived,
        c.name AS customer, 
        st.description, 
        ts.description AS status
    FROM 
        support_ticket AS st
    LEFT JOIN 
        customer AS c ON st.customer_id = c.id
    LEFT JOIN 
        ticket_status AS ts ON st.status = ts.id
    ORDER BY 
        st.arrived DESC
    `);

    res.render("tickets.ejs", { tickets });
  } catch (err) {
    console.error("Error fetching tickets:", err);
    res.status(500).send("Internal Server Error");
  } finally {
    if (connection) {
      await connection.release();
    }
  }
});

app.get("/ticket",requireLogin, async (req, res) => {
  const ticketId = req.query.id;
  if (!ticketId) {
    return res
      .status(400)
      .render("error", { message: "Ticket ID is required" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const [ticketDetails] = await connection.execute(
      `
    SELECT 
        st.id, 
        DATE_FORMAT(st.arrived, '%Y-%m-%d %H:%i:%s') AS arrived,
        c.name AS customer, 
        st.description, 
        st.handled, 
        ts.description AS status, 
        st.status AS status_id
    FROM 
        support_ticket AS st
    LEFT JOIN 
        ticket_status AS ts ON st.status = ts.id
    LEFT JOIN 
        customer AS c ON st.customer_id = c.id
    WHERE 
        st.id = ?
    `,
      [ticketId]
    );

    const [messages] = await connection.execute(
      `
    SELECT 
        sm.created_at AS timestamp, 
        su.fullname AS sender,
        sm.body AS message
    FROM 
        support_message AS sm
    LEFT JOIN 
        system_user AS su ON sm.from_user = su.id
    WHERE 
        sm.ticket_id = ?
    ORDER BY 
        sm.created_at ASC
    `,
      [ticketId]
    );

    res.render("ticket.ejs", { ticket: ticketDetails[0], messages });
  } catch (err) {
    console.error("Error fetching ticket details:", err);
    res.status(500).send("Internal Server Error");
  } finally {
    if (connection) {
      await connection.release();
    }
  }
});

app.post("/reply",requireLogin, async (req, res) => {
  const { ticketId, message, reply_to } = req.body;

  const adminUserId = 1;

  if (!ticketId || !message) {
    return res.status(400).send("Ticket ID and message are required");
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.execute(
      `
      INSERT INTO support_message (ticket_id, from_user, body, created_at, reply_to)
      VALUES (?, ?, ?, NOW(), ?)
    `,
      [ticketId, adminUserId, message, reply_to || null]
    );

    res.redirect(`/ticket?id=${ticketId}`);
  } catch (err) {
    console.error("Error sending reply:", err);
    res.status(500).send("Internal Server Error");
  } finally {
    if (connection) {
      await connection.release();
    }
  }
});

app.post("/close-ticket",requireLogin, async (req, res) => {
  const { ticketId } = req.body;

  if (!ticketId) {
    return res.status(400).send("Ticket ID is required");
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.execute(
      `
      UPDATE support_ticket
      SET status = 4, handled = NOW()
      WHERE id = ?
    `,
      [ticketId]
    );

    res.redirect(`/ticket?id=${ticketId}`);
  } catch (err) {
    console.error("Error closing ticket:", err);
    res.status(500).send("Internal Server Error");
  } finally {
    if (connection) {
      await connection.release();
    }
  }
});

app.post("/update-status",requireLogin, async (req, res) => {
  const { ticketId, newStatus } = req.body;

  let connection;
  try {
    connection = await pool.getConnection();
    if (newStatus == 4) {
      await connection.execute(
        `
        UPDATE support_ticket
        SET status = ?, handled = NOW()
        WHERE id = ?
      `,
        [newStatus, ticketId]
      );
    } else {
      await connection.execute(
        `
        UPDATE support_ticket
        SET status = ?
        WHERE id = ?
      `,
        [newStatus, ticketId]
      );
    }

    res.redirect(`/ticket?id=${ticketId}`);
  } catch (err) {
    console.error("Error updating ticket status:", err);
    res.status(500).send("Internal Server Error");
  } finally {
    if (connection) {
      await connection.release();
    }
  }
});

app.post("/reopen-ticket",requireLogin, async (req, res) => {
  const { ticketId } = req.body;

  if (!ticketId) {
    return res.status(400).send("Ticket ID is required");
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.execute(
      `
      UPDATE support_ticket
      SET status = 1, handled = NULL  -- Assuming status 1 means 'open' and resetting handled time
      WHERE id = ?
    `,
      [ticketId]
    );

    res.redirect(`/ticket?id=${ticketId}`);
  } catch (err) {
    console.error("Error reopening ticket:", err);
    res.status(500).send("Internal Server Error");
  } finally {
    if (connection) {
      await connection.release();
    }
  }
});

// Route to get user profile
app.get("/user/:id", requireLogin, async (req, res) => {
  const userId = req.params.id;

  const sql = `SELECT * FROM system_user WHERE id = ?`;
  const [results] = await pool.execute(sql, [userId]);

  if (results.length > 0) {
    const user = results[0];
    res.render("userProfile.ejs", { user });
  } else {
    res.status(404).send("User not found");
  }
});

// Route to update user profile
app.post("/user/:id", requireLogin, async (req, res) => {
  const userId = req.params.id;
  const { fullname, email, password } = req.body;

  console.log("Updating user:", userId);
  console.log("New Full Name:", fullname);
  console.log("New Email:", email);
  console.log("New Password:", password); // Log the password input

  let updateSql;
  let params;
  
  if (password && password.trim() !== "") {
    const hashedPassword = await bcrypt.hash(password, 10);
    console.log("Hashed Password:", hashedPassword);
    updateSql = `UPDATE system_user SET fullname = ?, email = ?, password = ? WHERE id = ?`;
    params = [fullname, email, hashedPassword, userId];
  } else {
    updateSql = `UPDATE system_user SET fullname = ?, email = ? WHERE id = ?`;
    params = [fullname, email, userId];
  }
  
  

  try {
    await pool.execute(updateSql, params);
    console.log("User updated successfully");
  } catch (error) {
    console.error("Error updating user:", error);
    return res.render("index.ejs", { message: "Error updating user" });
  }

  // Verify the update
  const [updatedResults] = await pool.execute(`SELECT * FROM system_user WHERE id = ?`, [userId]);
  console.log("Updated User:", updatedResults);

  res.redirect("/user/" + userId); // Redirect to the user profile page
});

pool.getConnection()
  .then(connection => {
    console.log("Database connected successfully");
    connection.release();
  })
  .catch(err => {
    console.error("Database connection failed:", err);
  });

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

//   käytin apuna näitä vähän jokaisesta:
// - https://stackoverflow.com/questions/69256398/nodejs-express-api-ticketing-queue-system
// - https://github.com/arafaysaleem/ez_tickets_backend
// - https://github.com/pingcap/docs/blob/master/develop/dev-guide-sample-application-nodejs-mysql2.md
// - https://blog.logrocket.com/creating-scalable-graphql-api-mysql-apollo-node/
// - https://stackoverflow.com/questions/36049514/formatting-a-sql-server-datetime-into-y-m-d-hmos4-z-format-via-t-sql



