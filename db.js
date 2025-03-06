require('dotenv').config();
const mysql = require('mysql2');

const MYSQLHOST = process.env.MYSQLHOST;
const MYSQLUSER = process.env.MYSQLUSER;
const MYSQLPASSWORD = process.env.MYSQLPASSWORD;
const MYSQLDATABASE = process.env.MYSQLDATABASE;
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
