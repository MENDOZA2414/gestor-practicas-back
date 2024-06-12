const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const md5 = require('md5');
import {pool} from './db.js'

const app = express();

const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));

app.listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);
    console.log(`MYSQLHOST: ${process.env.MYSQLHOST}`);
    console.log(`MYSQLUSER: ${process.env.MYSQLUSER}`);
    console.log(`MYSQLPASSWORD: ${process.env.MYSQLPASSWORD}`);
    console.log(`MYSQLDATABASE: ${process.env.MYSQLDATABASE}`);
    console.log(`MYSQLPORT: ${process.env.MYSQLPORT}`);
});

// Ruta de prueba de conexión
app.get('/testConnection', (req, res) => {
    res.send('Connection successful');
});


// Configuración para imágenes (JPG, JPEG, PNG)
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50 MB
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
        if (!allowedTypes.includes(file.mimetype)) {
            const error = new Error('Formato de archivo no permitido');
            error.code = 'INVALID_FILE_TYPE';
            return cb(error, false);
        }
        cb(null, true);
    }
});

// Configuración para archivos PDF
const pdfStorage = multer.memoryStorage();
const pdfUpload = multer({
    storage: pdfStorage,
    limits: {
        fileSize: 100 * 1024 * 1024 // 100 MB
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
            const error = new Error('Formato de archivo no permitido');
            error.code = 'INVALID_FILE_TYPE';
            return cb(error, false);
        }
        cb(null, true);
    }
});

// Middleware para manejo de errores de multer
app.use((err, req, res, next) => {
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).send({
            status: 400,
            message: 'El tamaño del archivo no debe exceder 50 MB'
        });
    }

    if (err.code === 'INVALID_FILE_TYPE') {
        return res.status(400).send({
            status: 400,
            message: 'Formato de archivo no permitido. Solo se permiten archivos JPG, JPEG y PNG.'
        });
    }

    next(err);
});

// ------------------------------ METODOS GET ------------------------------------------
// Ruta para verificar cambios en la tabla 'documentoAlumno' en los últimos 10 segundos
app.get('/checkDbChanges', async (req, res) => {
    const query = `
        SELECT 
            COUNT(*) AS changeCount, 
            usuarioTipo 
        FROM 
            auditoria 
        WHERE 
            tabla = "documentoAlumno" 
            AND fecha > NOW() - INTERVAL 10 SECOND 
        GROUP BY 
            usuarioTipo
    `;

    try {
        const [results] = await pool.query(query);
        const hasChanges = results.length > 0;
        const changeTypes = results.map(result => result.usuarioTipo);
        res.json({ hasChanges, changeTypes });
    } catch (err) {
        console.error('Error checking for changes:', err);
        res.status(500).send({ message: 'Error checking for changes' });
    }
});

// Ruta para obtener un alumno por número de control
app.get('/alumno/:numControl', async (req, res) => {
    const numControl = req.params.numControl;
    const query = `SELECT * FROM alumno WHERE numControl = ?`;

    try {
        const [results] = await pool.query(query, [numControl]);
        if (results.length > 0) {
            const alumno = results[0];
            if (alumno.fotoPerfil) {
                alumno.fotoPerfil = alumno.fotoPerfil.toString('base64');
            }
            res.status(200).send(alumno);
        } else {
            res.status(400).send({ message: 'No existe el alumno' });
        }
    } catch (err) {
        console.error('Error fetching alumno:', err);
        res.status(500).send({ message: 'Error fetching alumno' });
    }
});

// Ruta para obtener una imagen de perfil por número de control
app.get('/image/:numControl', async (req, res) => {
    const numControl = req.params.numControl;
    const query = 'SELECT fotoPerfil FROM alumno WHERE numControl = ?';

    try {
        const [results] = await pool.query(query, [numControl]);
        if (results.length === 0 || !results[0].fotoPerfil) {
            return res.status(404).send({ message: 'Image not found' });
        }
        res.type('image/jpeg');
        res.send(results[0].fotoPerfil);
    } catch (err) {
        console.error('Error fetching image:', err);
        res.status(500).send({ message: 'Error fetching image', error: err });
    }
});

// Ruta para obtener aplicaciones por vacante ID
app.get('/aplicaciones/:vacanteID', async (req, res) => {
    const vacanteID = req.params.vacanteID;
    const query = `
        SELECT P.*, V.titulo AS vacanteTitulo
        FROM postulacionalumno P
        INNER JOIN vacantePractica V ON P.vacanteID = V.vacantePracticaID
        WHERE P.vacanteID = ?
    `;

    try {
        const [results] = await pool.query(query, [vacanteID]);
        if (results.length > 0) {
            res.status(200).send(results.map(postulacion => ({
                ...postulacion,
                cartaPresentacion: Buffer.from(postulacion.cartaPresentacion).toString('base64') // Convierte a base64
            })));
        } else {
            res.status(404).send({ message: 'No hay postulaciones' });
        }
    } catch (err) {
        console.error('Error en la consulta:', err);
        res.status(500).send({ message: 'Error en el servidor', error: err });
    }
});

// Ruta para obtener una carta de presentación por ID de postulación
app.get('/postulacionalumno/:id', async (req, res) => {
    const documentoID = req.params.id;
    const query = 'SELECT cartaPresentacion FROM postulacionalumno WHERE postulacionID = ?'; // Cambiado 'id' por 'postulacionID'

    try {
        const [results] = await pool.query(query, [documentoID]);
        if (results.length > 0) {
            const documento = results[0];
            res.setHeader('Content-Type', 'application/pdf');
            res.send(Buffer.from(documento.cartaPresentacion, 'binary'));
        } else {
            res.status(404).send({ message: 'Documento no encontrado' });
        }
    } catch (err) {
        res.status(500).send({ message: 'Error en el servidor: ' + err.message });
    }
});

// Ruta para verificar si un alumno ya ha aplicado a una vacante
app.get('/checkPostulacion/:alumnoID/:vacanteID', async (req, res) => {
    const { alumnoID, vacanteID } = req.params;
    const query = 'SELECT COUNT(*) as count FROM postulacionAlumno WHERE alumnoID = ? AND vacanteID = ?';

    try {
        const [results] = await pool.query(query, [alumnoID, vacanteID]);
        const alreadyApplied = results[0].count > 0;
        res.json({ aplicado: alreadyApplied });
    } catch (err) {
        console.error('Error verificando postulación:', err);
        res.status(500).json({ error: 'Error verificando postulación' });
    }
});

// Ruta para obtener postulaciones por ID de alumno
app.get('/postulaciones/:alumnoID', async (req, res) => {
    const alumnoID = req.params.alumnoID;
    const query = 'SELECT vacanteID FROM postulacionAlumno WHERE alumnoID = ?';

    try {
        const [results] = await pool.query(query, [alumnoID]);
        res.json(results);
    } catch (err) {
        console.error('Error obteniendo postulaciones:', err);
        res.status(500).json({ error: 'Error obteniendo postulaciones' });
    }
});

// Ruta para obtener un asesor interno por ID
app.get('/asesorInterno/:id', async (req, res) => {
    const asesorInternoID = req.params.id;
    const query = 'SELECT * FROM asesorInterno WHERE asesorInternoID = ?';

    try {
        console.log('Ejecutando consulta para obtener asesor interno con ID:', asesorInternoID);
        const [results] = await pool.query(query, [asesorInternoID]);
        console.log('Resultados de la consulta:', results);
        if (results.length > 0) {
            const asesor = results[0];
            if (asesor.fotoPerfil) {
                asesor.fotoPerfil = asesor.fotoPerfil.toString('base64');
            }
            res.status(200).send(asesor);
        } else {
            res.status(400).send({
                message: 'No existe el asesor interno'
            });
        }
    } catch (err) {
        console.error('Error obteniendo asesor interno:', err);
        res.status(500).send({ message: 'Error en el servidor: ' + err.message });
    }
});


// Ruta para obtener una entidad receptora por ID
app.get('/entidadReceptora/:id', async (req, res) => {
    const entidadID = req.params.id;
    const query = 'SELECT * FROM entidadReceptora WHERE entidadID = ?';

    try {
        const [results] = await pool.query(query, [entidadID]);
        if (results.length > 0) {
            const entidad = results[0];
            if (entidad.fotoPerfil) {
                entidad.fotoPerfil = entidad.fotoPerfil.toString('base64');
            }
            res.status(200).send(entidad);
        } else {
            res.status(400).send({
                message: 'No existe la entidad receptora'
            });
        }
    } catch (err) {
        console.error('Error obteniendo entidad receptora:', err);
        res.status(500).json({ error: 'Error obteniendo entidad receptora' });
    }
});

// Ruta para obtener todos los asesores internos
app.get('/asesoresInternos', async (req, res) => {
    const query = 'SELECT asesorInternoID, CONCAT(nombre, " ", apellidoPaterno, " ", apellidoMaterno) AS nombreCompleto FROM asesorInterno';

    try {
        const [results] = await pool.query(query);
        res.status(200).send(results);
    } catch (err) {
        res.status(500).send({ message: 'Error en el servidor: ' + err.message });
    }
});

// Ruta para obtener la práctica profesional de un alumno por su número de control
app.get('/practicaProfesional/alumno/:numControl', async (req, res) => {
    const numControl = req.params.numControl;
    const query = `
        SELECT * FROM practicasProfesionales 
        WHERE alumnoID = ? 
        ORDER BY fechaCreacion DESC LIMIT 1
    `;

    try {
        const [results] = await pool.query(query, [numControl]);
        if (results.length > 0) {
            res.status(200).send(results[0]);
        } else {
            res.status(404).send({ message: 'No se encontró una práctica profesional para este alumno' });
        }
    } catch (err) {
        res.status(500).send({ message: err.message });
    }
});

// Ruta para obtener un asesor externo por ID
app.get('/asesorExterno/:id', async (req, res) => {
    const asesorExternoID = req.params.id;
    const query = 'SELECT * FROM asesorExterno WHERE asesorExternoID = ?';

    try {
        const [results] = await pool.query(query, [asesorExternoID]);
        if (results.length > 0) {
            const asesor = results[0];
            if (asesor.fotoPerfil) {
                asesor.fotoPerfil = asesor.fotoPerfil.toString('base64');
            }
            res.status(200).send(asesor);
        } else {
            res.status(400).send({
                message: 'No existe el asesor externo'
            });
        }
    } catch (err) {
        console.error('Error obteniendo asesor externo:', err);
        res.status(500).send({ message: 'Error en el servidor: ' + err.message });
    }
});


// Ruta para obtener todos los documentos de un alumno
app.get('/documentoAlumnoSubidos/:alumnoID', async (req, res) => {
    const alumnoID = req.params.alumnoID;
    const query = 'SELECT documentoID AS id, nombreArchivo, estatus FROM documentosAlumnoSubido WHERE alumnoID = ?';

    try {
        const [results] = await pool.query(query, [alumnoID]);
        res.status(200).send(results.length > 0 ? results : []); // Enviar un arreglo vacío si no hay documentos
    } catch (err) {
        res.status(500).send({ message: 'Error en el servidor: ' + err.message });
    }
});

// Ruta para obtener todos los documentos enviados de un alumno desde la tabla documentoAlumno
app.get('/documentoAlumnoRegistrado/:alumnoID', async (req, res) => {
    const alumnoID = req.params.alumnoID;
    const query = 'SELECT documentoID AS id, nombreArchivo FROM documentoAlumno WHERE alumnoID = ? AND estatus = "En proceso"';

    try {
        const [results] = await pool.query(query, [alumnoID]);
        res.send(results.length > 0 ? results : []);
    } catch (err) {
        res.status(500).send({ message: 'Error en el servidor: ' + err.message });
    }
});

// Ruta para obtener un documento PDF desde la tabla documentosAlumnoSubido
app.get('/documentoAlumnoSubido/:id', async (req, res) => {
    const documentoID = req.params.id;
    const query = 'SELECT archivo, nombreArchivo FROM documentosAlumnoSubido WHERE documentoID = ?';

    try {
        const [results] = await pool.query(query, [documentoID]);
        if (results.length > 0) {
            const documento = results[0];
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="${documento.nombreArchivo}"`);
            res.send(Buffer.from(documento.archivo, 'binary'));
        } else {
            res.status(404).send({ message: 'Documento no encontrado' });
        }
    } catch (err) {
        res.status(500).send({ message: 'Error en el servidor: ' + err.message });
    }
});

// Ruta para obtener un documento PDF desde la tabla documentoAlumno
app.get('/documentoAlumno/:id', (req, res) => {
    const documentoID = req.params.id;
    const query = 'SELECT archivo, nombreArchivo FROM documentoAlumno WHERE documentoID = ?';

    connection.query(query, [documentoID], (err, result) => {
        if (err) {
            return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
        }
        if (result.length > 0) {
            const documento = result[0];
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="${documento.nombreArchivo}"`);
            res.send(Buffer.from(documento.archivo, 'binary'));
        } else {
            res.status(404).send({ message: 'Documento no encontrado' });
        }
    });
});
