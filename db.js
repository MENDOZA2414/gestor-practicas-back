const mysql = require('mysql2/promise');

const MYSQLHOST = process.env.MYSQLHOST || 'localhost';
const MYSQLUSER = process.env.MYSQLUSER || 'root';
const MYSQLPASSWORD = process.env.MYSQLPASSWORD || 'Jm241410';
const MYSQLDATABASE = process.env.MYSQLDATABASE || 'sistemaPracticas';
const MYSQLPORT = process.env.MYSQLPORT || 3306;

const pool = mysql.createPool({
    host: MYSQLHOST,
    user: MYSQLUSER,
    password: MYSQLPASSWORD,
    database: MYSQLDATABASE,
    port: MYSQLPORT,
    waitForConnections: true,
    connectionLimit: 10, 
    queueLimit: 0,
    connectTimeout: 100000,
});

module.exports = pool.promise();
