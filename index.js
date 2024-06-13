const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const md5 = require('md5');
const mysql = require('mysql2'); 
const pool = require('./db'); 
const app = express();

const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));


app.listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);
});

app.get('/', (req, res) => {
    res.send('Servidor funcionando');
});


app.get('/testConnection', async (req, res) => {
    const query = 'SELECT COUNT(*) as count FROM asesorInterno';

    try {
        const [results] = await pool.query(query);
        res.status(200).send({ message: 'Consulta exitosa', count: results[0].count });
    } catch (err) {
        console.error('Error en la consulta de prueba:', err);
        res.status(500).send({ message: 'Error en el servidor ejecutando la consulta de prueba', error: err.message });
    }
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
        FROM postulacionAlumno P
        INNER JOIN vacantePractica V ON P.vacanteID = V.vacantePracticaID
        WHERE P.vacanteID = ?
    `;

    try {
        const [results] = await pool.query(query, [vacanteID]);
        if (results.length > 0) {
            res.status(200).send(results.map(postulacion => ({
                ...postulacion,
                cartaPresentacion: postulacion.cartaPresentacion ? Buffer.from(postulacion.cartaPresentacion).toString('base64') : null // Convierte a base64 si existe
            })));
        } else {
            res.status(404).send({ message: 'No hay postulaciones' });
        }
    } catch (err) {
        console.error('Error en la consulta:', err);
        res.status(500).send({ message: 'ErroracceptPostulacion en el servidor', error: err });
    }
});


// Ruta para obtener una carta de presentación por ID de postulación
app.get('/postulacionAlumno/:id', async (req, res) => {
    const documentoID = req.params.id;
    const query = 'SELECT cartaPresentacion FROM postulacionAlumno WHERE postulacionID = ?'; // Cambiado 'id' por 'postulacionID'

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

// Ruta para obtener los documentos aprobados de un alumno
app.get('/documentoAlumnoAprobado/:alumnoID', async (req, res) => {
    const alumnoID = req.params.alumnoID;
    const query = 'SELECT documentoID AS id, nombreArchivo FROM documentoAlumno WHERE alumnoID = ? AND estatus = "Aceptado"';

    try {
        const [results] = await pool.query(query, [alumnoID]);
        res.send(results.length > 0 ? results : []);
    } catch (err) {
        res.status(500).send({ message: 'Error fetching approved documents' });
    }
});

// Obtener un documento de un alumno
app.get('/documentoAlumno/:id', async (req, res) => {
    const documentoID = req.params.id;
    const query = 'SELECT archivo, nombreArchivo FROM documentoAlumno WHERE documentoID = ?';

    try {
        const [result] = await pool.query(query, [documentoID]);

        if (result.length > 0) {
            const documento = result[0];
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="${documento.nombreArchivo}"`);
            res.send(Buffer.from(documento.archivo, 'binary'));
        } else {
            res.status(404).send({ message: 'Documento no encontrado' });
        }
    } catch (err) {
        console.error('Error en el servidor:', err);
        res.status(500).send({ message: 'Error en el servidor: ' + err.message });
    }
});

// Obtener todas las entidades
app.get('/entidades/all', async (req, res) => {
    const query = 'SELECT entidadID, nombreEntidad AS nombre, fotoPerfil AS logoEmpresa FROM entidadReceptora ORDER BY nombreEntidad';

    try {
        const [results] = await pool.query(query);
        results.forEach(row => {
            if (row.logoEmpresa) {
                row.logoEmpresa = `data:image/jpeg;base64,${Buffer.from(row.logoEmpresa).toString('base64')}`;
            }
        });
        res.status(200).send(results);
    } catch (err) {
        res.status(500).send({ message: 'Error en el servidor: ' + err.message });
    }
});

// Ruta para obtener los alumnos asignados a un asesor
app.get('/alumnos/:asesorID', async (req, res) => {
    const asesorID = req.params.asesorID;
    console.log(`Received request to fetch students for asesorID: ${asesorID}`);

    const query = 'SELECT numControl, nombre, turno, carrera, fotoPerfil FROM alumno WHERE asesorInternoID = ?';

    try {
        const [results] = await pool.query(query, [asesorID]);
        if (results.length === 0) {
            console.log('No students found for asesorID:', asesorID);
            return res.status(404).send({ message: 'No students found' });
        }
        console.log(`Found ${results.length} students for asesorID: ${asesorID}`);
        res.send(results);
    } catch (err) {
        console.error('Error fetching students:', err);
        res.status(500).send({ message: 'Error fetching students', error: err });
    }
});

// Obtener todos los alumnos
app.get('/alumnos/all', async (req, res) => {
    const asesorInternoID = req.query.asesorInternoID; // Obtener el ID del asesor interno del query parameter
    console.log('asesorInternoID recibido:', asesorInternoID);

    if (!asesorInternoID) {
        return res.status(400).send({ message: 'asesorInternoID es requerido' });
    }

    const query = 'SELECT numControl, CONCAT(nombre, " ", apellidoPaterno, " ", apellidoMaterno) AS nombre, fotoPerfil FROM alumno WHERE asesorInternoID = ? ORDER BY nombre';

    try {
        let [results] = await pool.query(query, [asesorInternoID]);
        console.log('Resultados de la consulta:', results);
        if (results.length === 0) {
            return res.status(404).send({ message: 'No students found' });
        }
        // Convertir la imagen a base64
        results = results.map(student => ({
            ...student,
            fotoPerfil: student.fotoPerfil ? `data:image/jpeg;base64,${Buffer.from(student.fotoPerfil).toString('base64')}` : null
        }));
        res.status(200).send(results);
    } catch (err) {
        console.error('Error en la consulta SQL:', err.message);
        res.status(500).send({ message: 'Error en el servidor: ' + err.message });
    }
});

// Ruta para obtener una vacante de práctica por ID
app.get('/vacantesPractica/:id', async (req, res) => {
    const vacantePracticaID = req.params.id;
    const query = 'SELECT * FROM vacantePractica WHERE vacantePracticaID = ?';

    try {
        const [result] = await pool.query(query, [vacantePracticaID]);
        if (result.length > 0) {
            let vacante = result[0];
            if (vacante.logoEmpresa) {
                vacante.logoEmpresa = `data:image/jpeg;base64,${Buffer.from(vacante.logoEmpresa).toString('base64')}`;
            }
            res.status(200).json(vacante);
        } else {
            res.status(400).send({ message: 'No existe la vacante' });
        }
    } catch (err) {
        console.error('Error en el servidor:', err);
        res.status(500).send({ message: 'Error en el servidor' });
    }
});

// Ruta para obtener las vacantes de práctica por ID de entidad
app.get('/vacantePractica/:entidadID', async (req, res) => {
    const entidadID = req.params.entidadID;

    const query = `
        SELECT vp.*, 
               ae.nombre AS nombreAsesorExterno, 
               ae.apellidoPaterno AS apellidoPaternoAsesorExterno, 
               ae.apellidoMaterno AS apellidoMaternoAsesorExterno, 
               er.nombreEntidad AS nombreEmpresa, 
               er.fotoPerfil AS logoEmpresa 
        FROM vacantePractica vp
        JOIN asesorExterno ae ON vp.asesorExternoID = ae.asesorExternoID
        JOIN entidadReceptora er ON vp.entidadID = er.entidadID
        WHERE vp.entidadID = ? 
        ORDER BY vp.vacantePracticaID DESC
    `;

    try {
        const [results] = await pool.query(query, [entidadID]);
        results.forEach(row => {
            if (row.logoEmpresa) {
                row.logoEmpresa = `data:image/jpeg;base64,${Buffer.from(row.logoEmpresa).toString('base64')}`;
            }
        });
        res.status(200).send(results);
    } catch (err) {
        res.status(500).send({
            message: err.message
        });
    }
});

// Obtener todas las vacantes prácticas
app.get('/vacantePractica/all/:page/:limit', async (req, res) => {
    const page = parseInt(req.params.page);
    const limit = parseInt(req.params.limit);
    const start = (page - 1) * limit;

    const query = `
        SELECT vp.*, 
               ae.nombre AS nombreAsesorExterno, 
               ae.apellidoPaterno AS apellidoPaternoAsesorExterno, 
               ae.apellidoMaterno AS apellidoMaternoAsesorExterno, 
               er.nombreEntidad AS nombreEmpresa, 
               er.fotoPerfil AS logoEmpresa 
        FROM vacantePractica vp
        JOIN asesorExterno ae ON vp.asesorExternoID = ae.asesorExternoID
        JOIN entidadReceptora er ON vp.entidadID = er.entidadID
        ORDER BY vp.vacantePracticaID DESC 
        LIMIT ?, ?
    `;

    try {
        const [results] = await pool.query(query, [start, limit]);
        results.forEach(row => {
            if (row.logoEmpresa) {
                row.logoEmpresa = `data:image/jpeg;base64,${Buffer.from(row.logoEmpresa).toString('base64')}`;
            }
        });
        res.status(200).send(results);
    } catch (err) {
        res.status(500).send({
            message: err.message
        });
    }
});

// Obtener alumnos por estatus y asesorInternoID
app.get('/alumnos', async (req, res) => {
    const { estatus, asesorInternoID } = req.query;
    let query = 'SELECT numControl, estatus, CONCAT(nombre, " ", apellidoPaterno, " ", apellidoMaterno) AS nombre, fotoPerfil FROM alumno WHERE 1=1';
    const params = [];

    if (estatus) {
        query += ' AND estatus = ?';
        params.push(estatus);
    } else {
        query += ' AND (estatus IS NULL OR estatus = "")';
    }

    if (asesorInternoID) {
        query += ' AND asesorInternoID = ?';
        params.push(asesorInternoID);
    }

    query += ' ORDER BY nombre';

    try {
        const [results] = await pool.query(query, params);
        if (results.length === 0) {
            return res.status(404).send({ message: 'No students found' });
        }

        const formattedResults = results.map(student => ({
            ...student,
            fotoPerfil: student.fotoPerfil ? `data:image/jpeg;base64,${Buffer.from(student.fotoPerfil).toString('base64')}` : null
        }));

        res.status(200).send(formattedResults);
    } catch (err) {
        console.error('Error fetching students:', err);
        res.status(500).send({ message: 'Error en el servidor' });
    }
});

// Obtener vacantes por estatus
app.get('/vacantePractica', async (req, res) => {
    const { estatus } = req.query;
    let query = `
      SELECT vp.*, 
             ae.nombre AS nombreAsesorExterno, 
             ae.apellidoPaterno AS apellidoPaternoAsesorExterno, 
             ae.apellidoMaterno AS apellidoMaternoAsesorExterno, 
             er.nombreEntidad AS nombreEmpresa, 
             er.fotoPerfil AS logoEmpresa 
      FROM vacantePractica vp
      JOIN asesorExterno ae ON vp.asesorExternoID = ae.asesorExternoID
      JOIN entidadReceptora er ON vp.entidadID = er.entidadID
      WHERE 1=1
    `;
    const params = [];

    if (estatus) {
        query += ' AND vp.estatus = ?';
        params.push(estatus);
    } else {
        query += ' AND (vp.estatus IS NULL OR vp.estatus = "")';
    }

    query += ' ORDER BY vp.vacantePracticaID DESC';

    try {
        const [results] = await pool.query(query, params);
        if (results.length === 0) {
            return res.status(404).send({ message: 'No internships found' });
        }

        results.forEach(row => {
            if (row.logoEmpresa) {
                row.logoEmpresa = `data:image/jpeg;base64,${Buffer.from(row.logoEmpresa).toString('base64')}`;
            }
        });

        res.status(200).send(results);
    } catch (err) {
        console.error('Error fetching internships:', err);
        res.status(500).send({ message: 'Error en el servidor' });
    }
});

// Obtener entidades por estatus
app.get('/entidades', async (req, res) => {
    const { estatus } = req.query;
    let query = 'SELECT entidadID, estatus, nombreEntidad AS nombre, fotoPerfil AS logoEmpresa FROM entidadReceptora WHERE 1=1';
    const params = [];

    if (estatus) {
        query += ' AND estatus = ?';
        params.push(estatus);
    } else {
        query += ' AND (estatus IS NULL OR estatus = "")';
    }

    query += ' ORDER BY nombreEntidad';

    try {
        const [results] = await pool.query(query, params);
        results.forEach(row => {
            if (row.logoEmpresa) {
                row.logoEmpresa = `data:image/jpeg;base64,${Buffer.from(row.logoEmpresa).toString('base64')}`;
            }
        });
        res.status(200).send(results);
    } catch (err) {
        console.error('Error fetching entities:', err);
        res.status(500).send({ message: 'Error en el servidor' });
    }
});

// Obtener prácticas profesionales por ID de entidad
app.get('/practicas/:entidadID', async (req, res) => {
    const { entidadID } = req.params;

    const query = `
        SELECT
            pp.practicaID,
            pp.tituloVacante,
            a.nombre AS nombreAlumno,
            a.apellidoPaterno AS apellidoAlumno,
            a.correo AS correoAlumno,
            ae.nombre AS nombreAsesorExterno,
            ae.apellidoPaterno AS apellidoAsesorExterno,
            pp.fechaInicio,
            pp.fechaFin,
            pp.estado
        FROM
            practicasProfesionales pp
        JOIN alumno a ON pp.alumnoID = a.numControl
        JOIN asesorExterno ae ON pp.asesorExternoID = ae.asesorExternoID
        WHERE
            pp.entidadID = ?;
    `;

    try {
        const [results] = await pool.query(query, [entidadID]);
        res.json(results);
    } catch (err) {
        console.error('Error fetching practicas profesionales:', err);
        res.status(500).json({ message: 'Error fetching practicas profesionales', error: err });
    }
});

// Ruta para obtener la práctica profesional de un alumno por su alumnoID
app.get('/practica/alumno/:alumnoID', async (req, res) => {
    const { alumnoID } = req.params;

    const query = `
        SELECT
            pp.practicaID,
            a.numControl,
            a.nombre AS nombreAlumno,
            a.apellidoPaterno AS apellidoAlumno,
            a.apellidoMaterno AS apellidoMaternoAlumno,
            ae.correo AS correoAsesorExterno,
            ae.nombre AS nombreAsesorExterno,
            ae.apellidoPaterno AS apellidoPaternoAsesorExterno,
            ae.apellidoMaterno AS apellidoMaternoAsesorExterno,
            er.numCelular AS numCelularEntidad,
            pp.fechaInicio,
            pp.fechaFin,
            pp.estado,
            pp.tituloVacante
        FROM
            practicasProfesionales pp
        JOIN alumno a ON pp.alumnoID = a.numControl
        JOIN asesorExterno ae ON pp.asesorExternoID = ae.asesorExternoID
        JOIN entidadReceptora er ON pp.entidadID = er.entidadID
        WHERE
            a.numControl = ?;
    `;

    try {
        const [results] = await pool.query(query, [alumnoID]);
        if (results.length === 0) {
            return res.status(404).json({ message: 'No practica profesional found for this alumnoID' });
        }
        res.json(results[0]);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching practica profesional', error: err });
    }
});

// Ruta para obtener todos los formatos con el contenido del archivo PDF
app.get('/api/formatos', async (req, res) => {
    const query = 'SELECT documentoID, nombreArchivo, archivo FROM formatos';

    try {
        const [results] = await pool.query(query);
        
        // Convertir cada archivo en base64
        const formatos = results.map(formato => {
            const archivoBase64 = formato.archivo.toString('base64');
            return {
                documentoID: formato.documentoID,
                nombreArchivo: formato.nombreArchivo,
                archivo: archivoBase64
            };
        });

        res.json(formatos);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching formatos', error: err });
    }
});

// ------------------------------ METODOS POST ------------------------------------------
// Ruta para crear una nueva vacante de práctica
app.post('/vacantePractica', async (req, res) => {
    const { titulo, fechaInicio, fechaFinal, ciudad, tipoTrabajo, descripcion, entidadID, asesorExternoID } = req.body;

    if (!entidadID) {
        return res.status(400).send({
            message: "El campo 'entidadID' es requerido."
        });
    }

    const insertQuery = `
        INSERT INTO vacantePractica (titulo, fechaInicio, fechaFinal, ciudad, tipoTrabajo, descripcion, entidadID, asesorExternoID)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const selectQuery = `SELECT * FROM vacantePractica WHERE vacantePracticaID = ?`;

    try {
        const [result] = await pool.query(insertQuery, [titulo, fechaInicio, fechaFinal, ciudad, tipoTrabajo, descripcion, entidadID, asesorExternoID]);
        const [result2] = await pool.query(selectQuery, [result.insertId]);
        res.status(201).send({
            status: 201,
            message: 'Vacante creada con éxito',
            data: result2[0]
        });
    } catch (err) {
        res.status(400).send({
            message: err.message
        });
    }
});

// Ruta para verificar si un correo electrónico ya está en uso en varias tablas
app.post('/checkDuplicateEmail', async (req, res) => {
    const { correo } = req.body;
    const queries = [
        `SELECT correo FROM entidadReceptora WHERE correo = ?`,
        `SELECT correo FROM alumno WHERE correo = ?`,
        `SELECT correo FROM asesorInterno WHERE correo = ?`,
        `SELECT correo FROM asesorExterno WHERE correo = ?`,
        `SELECT correo FROM administrador WHERE correo = ?`
    ];

    try {
        for (const query of queries) {
            const [result] = await pool.query(query, [correo]);
            if (result.length > 0) {
                return res.status(200).send({
                    exists: true
                });
            }
        }
        res.status(200).send({
            exists: false
        });
    } catch (err) {
        res.status(500).send({
            message: 'Error en el servidor'
        });
    }
});

// Ruta para verificar si un número de celular ya está en uso en varias tablas
app.post('/checkDuplicatePhone', async (req, res) => {
    const { numCelular } = req.body;
    const queries = [
        `SELECT numCelular FROM entidadReceptora WHERE numCelular = ?`,
        `SELECT numCelular FROM alumno WHERE numCelular = ?`,
        `SELECT numCelular FROM asesorInterno WHERE numCelular = ?`,
        `SELECT numCelular FROM asesorExterno WHERE numCelular = ?`,
        `SELECT numCelular FROM administrador WHERE numCelular = ?`
    ];

    try {
        for (const query of queries) {
            const [result] = await pool.query(query, [numCelular]);
            if (result.length > 0) {
                return res.status(200).send({
                    exists: true
                });
            }
        }
        res.status(200).send({
            exists: false
        });
    } catch (err) {
        res.status(500).send({
            message: 'Error en el servidor'
        });
    }
});

// Ruta para verificar si un correo electrónico ya está en uso en varias tablas, excluyendo un ID específico
app.post('/checkDuplicateEmailAlumno', async (req, res) => {
    const { correo, numControl } = req.body;
    const queries = [
        `SELECT correo FROM entidadReceptora WHERE correo = ? AND entidadID <> ?`,
        `SELECT correo FROM alumno WHERE correo = ? AND numControl <> ?`,
        `SELECT correo FROM asesorInterno WHERE correo = ? AND asesorInternoID <> ?`,
        `SELECT correo FROM asesorExterno WHERE correo = ? AND asesorExternoID <> ?`,
        `SELECT correo FROM administrador WHERE correo = ? AND adminID <> ?`
    ];

    try {
        for (const query of queries) {
            const [result] = await pool.query(query, [correo, numControl]);
            if (result.length > 0) {
                return res.status(200).send({
                    exists: true
                });
            }
        }
        res.status(200).send({
            exists: false
        });
    } catch (err) {
        res.status(500).send({
            message: 'Error en el servidor'
        });
    }
});

// Ruta para verificar si un número de celular ya está en uso en varias tablas
app.post('/checkDuplicatePhoneAlumno', async (req, res) => {
    const { numCelular, numControl } = req.body;

    const queries = [
        { query: 'SELECT numCelular FROM entidadReceptora WHERE numCelular = ? AND entidadID <> ?', idField: 'entidadID' },
        { query: 'SELECT numCelular FROM alumno WHERE numCelular = ? AND numControl <> ?', idField: 'numControl' },
        { query: 'SELECT numCelular FROM asesorInterno WHERE numCelular = ? AND asesorInternoID <> ?', idField: 'asesorInternoID' },
        { query: 'SELECT numCelular FROM asesorExterno WHERE numCelular = ? AND asesorExternoID <> ?', idField: 'asesorExternoID' },
        { query: 'SELECT numCelular FROM administrador WHERE numCelular = ? AND adminID <> ?', idField: 'adminID' }
    ];

    try {
        for (const { query, idField } of queries) {
            const [result] = await pool.query(query, [numCelular, numControl]);
            if (result.length > 0) {
                return res.status(200).send({ exists: true });
            }
        }
        return res.status(200).send({ exists: false });
    } catch (error) {
        console.error('Error en la verificación de duplicados:', error);
        return res.status(500).send({ message: 'Error en el servidor' });
    }
});

// Ruta para verificar si un correo electrónico ya está en uso en varias tablas, excluyendo un ID específico
app.post('/checkDuplicateEmailExceptCurrent', async (req, res) => {
    const { correo, id } = req.body;

    const queries = [
        `SELECT correo FROM entidadReceptora WHERE correo = ? AND entidadID <> ?`,
        `SELECT correo FROM alumno WHERE correo = ? AND numControl <> ?`,
        `SELECT correo FROM asesorInterno WHERE correo = ? AND asesorInternoID <> ?`,
        `SELECT correo FROM asesorExterno WHERE correo = ? AND asesorExternoID <> ?`,
        `SELECT correo FROM administrador WHERE correo = ? AND adminID <> ?`
    ];

    try {
        for (const query of queries) {
            const [result] = await pool.query(query, [correo, id]);
            if (result.length > 0) {
                return res.status(200).send({ exists: true });
            }
        }
        return res.status(200).send({ exists: false });
    } catch (error) {
        console.error('Error en la verificación de duplicados:', error);
        return res.status(500).send({ message: 'Error en el servidor' });
    }
});

// Ruta para verificar si un número de celular ya está en uso en varias tablas, excluyendo un ID específico
app.post('/checkDuplicatePhoneExceptCurrent', async (req, res) => {
    const { numCelular, id } = req.body;

    const queries = [
        { query: 'SELECT numCelular FROM entidadReceptora WHERE numCelular = ? AND entidadID <> ?', idField: 'entidadID' },
        { query: 'SELECT numCelular FROM alumno WHERE numCelular = ? AND numControl <> ?', idField: 'numControl' },
        { query: 'SELECT numCelular FROM asesorInterno WHERE numCelular = ? AND asesorInternoID <> ?', idField: 'asesorInternoID' },
        { query: 'SELECT numCelular FROM asesorExterno WHERE numCelular = ? AND asesorExternoID <> ?', idField: 'asesorExternoID' },
        { query: 'SELECT numCelular FROM administrador WHERE numCelular = ? AND adminID <> ?', idField: 'adminID' }
    ];

    try {
        for (const { query, idField } of queries) {
            const [result] = await pool.query(query, [numCelular, id]);
            if (result.length > 0) {
                return res.status(200).send({ exists: true });
            }
        }
        return res.status(200).send({ exists: false });
    } catch (error) {
        console.error('Error en la verificación de duplicados:', error);
        return res.status(500).send({ message: 'Error en el servidor' });
    }
});

// Ruta para registrar una postulación
app.post('/registerPostulacion', pdfUpload.single('cartaPresentacion'), async (req, res) => {
    const { alumnoID, vacanteID } = req.body;
    const cartaPresentacion = req.file ? req.file.buffer : null;

    if (!alumnoID || !vacanteID || !cartaPresentacion) {
        return res.status(400).send({
            status: 400,
            message: 'Todos los campos son obligatorios'
        });
    }

    try {
        const [alumnoResult] = await pool.query(`SELECT nombre, correo FROM alumno WHERE numControl = ?`, [alumnoID]);
        
        if (alumnoResult.length === 0) {
            return res.status(404).send({
                status: 404,
                message: 'Alumno no encontrado'
            });
        }

        const { nombre, correo } = alumnoResult[0];

        const [insertResult] = await pool.query(
            `INSERT INTO postulacionAlumno (alumnoID, vacanteID, nombreAlumno, correoAlumno, cartaPresentacion) VALUES (?, ?, ?, ?, ?)`,
            [alumnoID, vacanteID, nombre, correo, cartaPresentacion]
        );

        return res.status(201).send({
            status: 201,
            message: 'Postulación registrada con éxito',
            data: { insertId: insertResult.insertId }
        });

    } catch (err) {
        return res.status(400).send({
            status: 400,
            message: err.message
        });
    }
});

// Ruta para registrar un asesor interno
app.post('/asesorInterno', upload.single('fotoPerfil'), async (req, res) => {
    const { nombre, apellidoPaterno, apellidoMaterno, correo, contraseña, numCelular } = req.body;
    const fotoPerfil = req.file ? req.file.buffer : null;

    const query = `
        INSERT INTO asesorInterno (nombre, apellidoPaterno, apellidoMaterno, correo, contraseña, numCelular, fotoPerfil)
        VALUES (?, ?, ?, ?, md5(?), ?, ?)
    `;

    try {
        const [result] = await pool.query(query, [nombre, apellidoPaterno, apellidoMaterno, correo, contraseña, numCelular, fotoPerfil]);
        res.status(201).send({
            status: 201,
            message: 'Asesor interno registrado con éxito',
            data: { insertId: result.insertId }
        });
    } catch (err) {
        res.status(400).send({
            message: err.message
        });
    }
});

// Ruta para registrar una entidad receptora
app.post('/register/entidadReceptora', upload.single('fotoPerfil'), async (req, res) => {
    const { nombreEntidad, nombreUsuario, direccion, categoria, correo, password, numCelular } = req.body;
    const fotoPerfil = req.file ? req.file.buffer : null;

    if (!nombreEntidad || !nombreUsuario || !direccion || !categoria || !correo || !password || !numCelular) {
        return res.status(400).send({
            status: 400,
            message: 'Todos los campos son obligatorios'
        });
    }

    const query = `
        INSERT INTO entidadReceptora (nombreEntidad, nombreUsuario, direccion, categoria, correo, contraseña, numCelular, fotoPerfil)
        VALUES (?, ?, ?, ?, ?, md5(?), ?, ?)
    `;

    try {
        const [result] = await pool.query(query, [nombreEntidad, nombreUsuario, direccion, categoria, correo, password, numCelular, fotoPerfil]);
        res.status(201).send({
            status: 201,
            message: 'Entidad receptora registrada con éxito',
            data: { insertId: result.insertId }
        });
    } catch (err) {
        res.status(400).send({
            status: 400,
            message: err.message
        });
    }
});

// Registro de alumnos
app.post('/register/alumno', upload.single('foto'), async (req, res) => {
    const { numeroControl, nombre, apellidoPaterno, apellidoMaterno, fechaNacimiento, carrera, semestre, turno, email, password, celular, asesorInternoID } = req.body;
    const foto = req.file ? req.file.buffer : null;

    if (!numeroControl || !nombre || !apellidoPaterno || !apellidoMaterno || !fechaNacimiento || !carrera || !semestre || !turno || !email || !password || !celular) {
        return res.status(400).send({
            status: 400,
            message: 'Todos los campos son obligatorios'
        });
    }

    const query = `
        INSERT INTO alumno (numControl, nombre, apellidoPaterno, apellidoMaterno, fechaNacimiento, carrera, semestre, turno, correo, contraseña, numCelular, fotoPerfil, asesorInternoID)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, md5(?), ?, ?, ?)
    `;

    try {
        const [result] = await pool.query(query, [numeroControl, nombre, apellidoPaterno, apellidoMaterno, fechaNacimiento, carrera, semestre, turno, email, password, celular, foto, asesorInternoID]);
        return res.status(201).send({
            status: 201,
            message: 'Alumno registrado con éxito',
            data: { insertId: result.insertId }
        });
    } catch (err) {
        return res.status(400).send({
            status: 400,
            message: err.message
        });
    }
});

// Ruta para registrar un asesor interno
app.post('/register/asesorInterno', upload.single('fotoPerfil'), async (req, res) => {
    const { nombre, apellidoPaterno, apellidoMaterno, correo, password, numCelular } = req.body;
    const fotoPerfil = req.file ? req.file.buffer : null;

    if (!nombre || !apellidoPaterno || !apellidoMaterno || !correo || !password || !numCelular) {
        return res.status(400).send({
            status: 400,
            message: 'Todos los campos son obligatorios'
        });
    }

    const query = `
        INSERT INTO asesorInterno (nombre, apellidoPaterno, apellidoMaterno, correo, contraseña, numCelular, fotoPerfil)
        VALUES (?, ?, ?, ?, md5(?), ?, ?)
    `;

    try {
        const [result] = await pool.query(query, [nombre, apellidoPaterno, apellidoMaterno, correo, password, numCelular, fotoPerfil]);
        return res.status(201).send({
            status: 201,
            message: 'Asesor interno registrado con éxito',
            data: { insertId: result.insertId }
        });
    } catch (err) {
        return res.status(400).send({
            status: 400,
            message: err.message
        });
    }
});

// Ruta para registrar un asesor externo
app.post('/register/asesorExterno', upload.single('fotoPerfil'), async (req, res) => {
    const { nombre, apellidoPaterno, apellidoMaterno, correo, password, numCelular, entidadID } = req.body;
    const fotoPerfil = req.file ? req.file.buffer : null;

    if (!nombre || !apellidoPaterno || !apellidoMaterno || !correo || !password || !numCelular || !entidadID) {
        return res.status(400).send({
            status: 400,
            message: 'Todos los campos son obligatorios'
        });
    }

    const query = `
        INSERT INTO asesorExterno (nombre, apellidoPaterno, apellidoMaterno, correo, contraseña, numCelular, fotoPerfil, entidadID)
        VALUES (?, ?, ?, ?, md5(?), ?, ?, ?)
    `;

    try {
        const [result] = await pool.query(query, [nombre, apellidoPaterno, apellidoMaterno, correo, password, numCelular, fotoPerfil, entidadID]);
        return res.status(201).send({
            status: 201,
            message: 'Asesor externo registrado con éxito',
            data: { insertId: result.insertId }
        });
    } catch (err) {
        return res.status(400).send({
            status: 400,
            message: err.message
        });
    }
});

// Ruta para el inicio de sesión de un alumno
app.post('/login/alumno', async (req, res) => {
    const { email, password } = req.body;

    const query = `SELECT * FROM alumno WHERE correo = ? AND contraseña = md5(?)`;

    try {
        const [result] = await pool.query(query, [email, password]);
        if (result.length > 0) {
            const alumno = result[0];
            if (alumno.fotoPerfil) {
                alumno.fotoPerfil = alumno.fotoPerfil.toString('base64');
            }
            return res.status(200).send(alumno);
        } else {
            return res.status(401).send({ status: 401, message: 'Correo o contraseña incorrectos' });
        }
    } catch (err) {
        return res.status(500).send({ message: 'Error en el servidor' });
    }
});

// Ruta para el inicio de sesión de una entidad receptora
app.post('/login/entidad', async (req, res) => {
    const { email, password } = req.body;

    const query = `SELECT * FROM entidadReceptora WHERE correo = ? AND contraseña = md5(?)`;

    try {
        const [result] = await pool.query(query, [email, password]);
        if (result.length > 0) {
            const entidad = result[0];
            if (entidad.fotoPerfil) {
                entidad.fotoPerfil = entidad.fotoPerfil.toString('base64');
            }
            return res.status(200).send(entidad);
        } else {
            return res.status(401).send({ status: 401, message: 'Correo o contraseña incorrectos' });
        }
    } catch (err) {
        return res.status(500).send({ message: 'Error en el servidor' });
    }
});

// Ruta para el inicio de sesión de asesor interno
app.post('/login/asesorInterno', async (req, res) => {
    const { email, password } = req.body;

    const query = `SELECT * FROM asesorInterno WHERE correo = ? AND contraseña = md5(?)`;

    try {
        const [result] = await pool.query(query, [email, password]);
        if (result.length > 0) {
            const asesor = result[0];
            if (asesor.fotoPerfil) {
                asesor.fotoPerfil = asesor.fotoPerfil.toString('base64');
            }
            return res.status(200).send(asesor);
        } else {
            return res.status(401).send({ status: 401, message: 'Correo o contraseña incorrectos' });
        }
    } catch (err) {
        return res.status(500).send({ message: 'Error en el servidor' });
    }
});

// Ruta para el inicio de sesión de asesor externo
app.post('/login/asesorExterno', async (req, res) => {
    const { email, password } = req.body;

    const query = `SELECT * FROM asesorExterno WHERE correo = ? AND contraseña = md5(?)`;

    try {
        const [result] = await pool.query(query, [email, password]);
        if (result.length > 0) {
            const asesor = result[0];
            if (asesor.fotoPerfil) {
                asesor.fotoPerfil = asesor.fotoPerfil.toString('base64');
            }
            return res.status(200).send(asesor);
        } else {
            return res.status(401).send({ status: 401, message: 'Correo o contraseña incorrectos' });
        }
    } catch (err) {
        return res.status(500).send({ message: 'Error en el servidor' });
    }
});

// Endpoint para rechazar una postulación
app.post('/rejectPostulacion', async (req, res) => {
    const { postulacionID } = req.body;

    const queryDeletePostulacion = `
        DELETE FROM postulacionAlumno
        WHERE postulacionID = ?
    `;

    try {
        const [result] = await pool.query(queryDeletePostulacion, [postulacionID]);
        if (result.affectedRows === 0) {
            return res.status(404).send({ message: 'No se encontró la postulación' });
        }

        res.status(200).send({ message: 'Postulación eliminada con éxito' });
    } catch (error) {
        res.status(500).send({ message: 'Error en el servidor al eliminar la postulación', error: error.message });
    }
});

// Ruta para aceptar una postulación
app.post('/acceptPostulacion', async (req, res) => {
    const { postulacionID } = req.body;

    const queryPostulacion = `
        SELECT 
            p.alumnoID, p.vacanteID, p.nombreAlumno, p.correoAlumno,
            v.entidadID, v.asesorExternoID, v.titulo AS tituloVacante,
            v.fechaInicio, v.fechaFinal
        FROM 
            postulacionAlumno p
        JOIN 
            vacantePractica v ON p.vacanteID = v.vacantePracticaID
        WHERE 
            p.postulacionID = ?
    `;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [result] = await connection.query(queryPostulacion, [postulacionID]);
        
        if (result.length === 0) {
            await connection.rollback();
            return res.status(404).send({ message: 'No se encontró la postulación' });
        }

        const postulacion = result[0];
        const fechaInicio = postulacion.fechaInicio instanceof Date ? postulacion.fechaInicio.toISOString().split('T')[0] : postulacion.fechaInicio;
        const fechaFinal = postulacion.fechaFinal instanceof Date ? postulacion.fechaFinal.toISOString().split('T')[0] : postulacion.fechaFinal;

        const queryInsertPractica = `
            INSERT INTO practicasProfesionales 
            (alumnoID, entidadID, asesorExternoID, fechaInicio, fechaFin, estado, tituloVacante, fechaCreacion)
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
        `;

        const values = [
            postulacion.alumnoID, 
            postulacion.entidadID, 
            postulacion.asesorExternoID, 
            fechaInicio, 
            fechaFinal, 
            'Iniciada',
            postulacion.tituloVacante
        ];

        await connection.query(queryInsertPractica, values);

        // Eliminar todas las postulaciones del alumno en todas las vacantes y entidades
        const queryDeletePostulaciones = `
            DELETE FROM postulacionAlumno WHERE alumnoID = ?
        `;
        await connection.query(queryDeletePostulaciones, [postulacion.alumnoID]);

        // Eliminar la vacante actual
        const queryDeleteVacante = `
            DELETE FROM vacantePractica WHERE vacantePracticaID = ?
        `;
        await connection.query(queryDeleteVacante, [postulacion.vacanteID]);

        await connection.commit();
        res.status(201).send({ message: 'Práctica profesional registrada, postulaciones eliminadas y vacante eliminada con éxito' });

    } catch (error) {
        await connection.rollback();
        res.status(500).send({ message: 'Error en el servidor al registrar la práctica profesional', error: error.message });
    } finally {
        connection.release();
    }
});



// Ruta para subir un documento de alumno
app.post('/uploadDocumentoAlumno', pdfUpload.single('file'), async (req, res) => {
    const { alumnoID, nombreArchivo, usuarioTipo } = req.body;
    const archivo = req.file.buffer;

    const queryInsertDocumento = `INSERT INTO documentoAlumno (alumnoID, nombreArchivo, archivo) VALUES (?, ?, ?)`;
    const queryInsertAuditoria = `INSERT INTO auditoria (tabla, accion, usuarioTipo) VALUES ('documentoAlumno', 'INSERT', ?)`;

    try {
        const [result] = await pool.query(queryInsertDocumento, [alumnoID, nombreArchivo, archivo]);

        await pool.query(queryInsertAuditoria, [usuarioTipo]);

        return res.status(201).send({
            status: 201,
            message: 'Documento subido con éxito',
            documentoID: result.insertId,
        });
    } catch (err) {
        console.error('Error al guardar el documento en la base de datos:', err);
        return res.status(500).send({
            status: 500,
            message: 'Error al guardar el documento en la base de datos: ' + err.message,
        });
    }
});

// Ruta para subir un documento de alumno
app.post('/uploadDocumentoAlumnoSubido', pdfUpload.single('file'), async (req, res) => {
    const { alumnoID, nombreArchivo } = req.body;
    const archivo = req.file.buffer;

    const queryInsertDocumento = `INSERT INTO documentosAlumnoSubido (alumnoID, nombreArchivo, archivo, estatus) VALUES (?, ?, ?, 'Subido')`;

    try {
        const [result] = await pool.query(queryInsertDocumento, [alumnoID, nombreArchivo, archivo]);

        return res.status(201).send({
            status: 201,
            message: 'Documento subido con éxito',
            documentoID: result.insertId,
        });
    } catch (err) {
        console.error('Error al guardar el documento en la base de datos:', err);
        return res.status(500).send({
            status: 500,
            message: 'Error al guardar el documento en la base de datos: ' + err.message,
        });
    }
});

// Ruta para aprobar un documento
app.post('/documentoAlumno/approve', async (req, res) => {
    const { documentId, userType } = req.body;

    const selectQuery = 'SELECT * FROM documentoAlumno WHERE documentoID = ?';
    const updateQuery = 'UPDATE documentoAlumno SET estatus = "Aceptado", usuarioTipo = ? WHERE documentoID = ?';
    const updateSubidoQuery = 'UPDATE documentosAlumnoSubido SET estatus = "Aceptado" WHERE nombreArchivo = ? AND alumnoID = ?';
    const auditQuery = 'INSERT INTO auditoria (tabla, accion, fecha, usuarioTipo) VALUES (?, ?, ?, ?)';

    try {
        const [results] = await pool.query(selectQuery, [documentId]);
        
        if (results.length === 0) {
            return res.status(404).send({ message: 'Document not found' });
        }

        await pool.query(updateQuery, [userType, documentId]);
        await pool.query(updateSubidoQuery, [results[0].nombreArchivo, results[0].alumnoID]);
        await pool.query(auditQuery, ['documentoAlumno', 'UPDATE', new Date(), userType]);

        res.status(200).send({ message: 'Document approved successfully' });
    } catch (err) {
        console.error('Error approving documentoAlumno:', err);
        return res.status(500).send({ message: 'Error approving document' });
    }
});

// Ruta para rechazar un documento
app.post('/documentoAlumno/reject', async (req, res) => {
    const { documentId, userType } = req.body;

    const selectQuery = 'SELECT * FROM documentoAlumno WHERE documentoID = ?';
    const deleteQuery = 'DELETE FROM documentoAlumno WHERE documentoID = ?';
    const updateSubidoQuery = 'UPDATE documentosAlumnoSubido SET estatus = "Rechazado" WHERE nombreArchivo = ? AND alumnoID = ?';
    const auditQuery = 'INSERT INTO auditoria (tabla, accion, fecha, usuarioTipo) VALUES (?, ?, ?, ?)';

    try {
        const [results] = await pool.query(selectQuery, [documentId]);
        
        if (results.length === 0) {
            return res.status(404).send({ message: 'Document not found' });
        }

        await pool.query(deleteQuery, [documentId]);
        await pool.query(updateSubidoQuery, [results[0].nombreArchivo, results[0].alumnoID]);
        await pool.query(auditQuery, ['documentoAlumno', 'DELETE', new Date(), userType]);

        res.status(200).send({ message: 'Document rejected successfully' });
    } catch (err) {
        console.error('Error rejecting documentoAlumno:', err);
        return res.status(500).send({ message: 'Error rejecting document' });
    }
});

// Ruta para enviar un documento de un alumno a la tabla documentoAlumno
app.post('/enviarDocumentoAlumno', async (req, res) => {
    const { documentoID, userType } = req.body;
    const selectQuery = 'SELECT * FROM documentosAlumnoSubido WHERE documentoID = ?';
    const insertQuery = 'INSERT INTO documentoAlumno (alumnoID, nombreArchivo, archivo, estatus, usuarioTipo) VALUES (?, ?, ?, "En proceso", ?)';
    const updateQuery = 'UPDATE documentosAlumnoSubido SET estatus = "En proceso" WHERE documentoID = ?';

    try {
        const [result] = await pool.query(selectQuery, [documentoID]);

        if (result.length === 0) {
            return res.status(404).send({ message: 'Documento no encontrado' });
        }

        const documento = result[0];
        const [insertResult] = await pool.query(insertQuery, [documento.alumnoID, documento.nombreArchivo, documento.archivo, userType]);
        await pool.query(updateQuery, [documentoID]);

        return res.status(201).send({
            message: 'Documento enviado con éxito',
            documentoID: insertResult.insertId,
        });
    } catch (err) {
        console.error('Error al procesar el documento:', err);
        return res.status(500).send({ message: 'Error al procesar el documento: ' + err.message });
    }
});

// Ruta para subir un documento a la tabla formatos
app.post('/api/uploadFormato', pdfUpload.single('file'), async (req, res) => {
    const { nombreArchivo } = req.body;
    const archivo = req.file.buffer;
    const query = 'INSERT INTO formatos (nombreArchivo, archivo) VALUES (?, ?)';

    try {
        const [result] = await pool.query(query, [nombreArchivo, archivo]);
        return res.status(201).send({
            message: 'Documento subido con éxito',
            documentoID: result.insertId,
        });
    } catch (err) {
        console.error('Error al guardar el documento en la base de datos:', err);
        return res.status(500).send({
            message: 'Error al guardar el documento en la base de datos: ' + err.message,
        });
    }
});

// ------------------------------ METODOS DELETE ------------------------------------------
// Ruta para eliminar un documento de la tabla documentoAlumno y actualizar el estatus
app.delete('/documentoAlumno/:id', async (req, res) => {
    const documentoID = req.params.id;

    // Primero, obtenemos el nombre del archivo desde documentoAlumno usando el documentoID
    const selectQuery = 'SELECT nombreArchivo, alumnoID FROM documentoAlumno WHERE documentoID = ?';
    const deleteQuery = 'DELETE FROM documentoAlumno WHERE documentoID = ?';
    const updateQuery = 'UPDATE documentosAlumnoSubido SET estatus = "Eliminado" WHERE nombreArchivo = ? AND alumnoID = ?';

    try {
        const [result] = await pool.query(selectQuery, [documentoID]);

        if (result.length === 0) {
            return res.status(404).send({ message: 'Documento no encontrado' });
        }

        const { nombreArchivo, alumnoID } = result[0];

        const [deleteResult] = await pool.query(deleteQuery, [documentoID]);

        if (deleteResult.affectedRows === 0) {
            return res.status(404).send({ message: 'Documento no encontrado' });
        }

        await pool.query(updateQuery, [nombreArchivo, alumnoID]);

        res.send({ message: 'Documento eliminado con éxito' });
    } catch (err) {
        console.error('Error en el servidor:', err);
        return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
    }
});

// Ruta para eliminar un documento de la tabla documentosAlumnoSubido
app.delete('/documentoAlumnoSubido/:id', async (req, res) => {
    const documentoID = req.params.id;
    const query = 'DELETE FROM documentosAlumnoSubido WHERE documentoID = ?';

    try {
        const [result] = await pool.query(query, [documentoID]);

        if (result.affectedRows > 0) {
            res.send({ message: 'Documento eliminado con éxito' });
        } else {
            res.status(404).send({ message: 'Documento no encontrado' });
        }
    } catch (err) {
        console.error('Error en el servidor:', err);
        return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
    }
});

// Eliminar alumno
app.delete('/alumno/:numControl', async (req, res) => {
    const numControl = req.params.numControl;
    const checkStatusQuery = 'SELECT estatus FROM alumno WHERE numControl = ?';
    const deleteQuery = 'DELETE FROM alumno WHERE numControl = ?';

    try {
        const [result] = await pool.query(checkStatusQuery, [numControl]);

        if (result.length > 0 && result[0].estatus === 'Aceptado') {
            await pool.query(deleteQuery, [numControl]);
            res.status(200).send({ message: 'Alumno eliminado con éxito' });
        } else {
            res.status(403).send({ message: 'Solo se pueden eliminar elementos aceptados' });
        }
    } catch (err) {
        console.error('Error en el servidor:', err);
        return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
    }
});

// Eliminar vacante
app.delete('/vacantePractica/:vacantePracticaID', async (req, res) => {
    const vacantePracticaID = req.params.vacantePracticaID;
    const checkStatusQuery = 'SELECT estatus FROM vacantePractica WHERE vacantePracticaID = ?';
    const deleteQuery = 'DELETE FROM vacantePractica WHERE vacantePracticaID = ?';

    try {
        const [result] = await pool.query(checkStatusQuery, [vacantePracticaID]);

        if (result.length > 0 && result[0].estatus === 'Aceptado') {
            await pool.query(deleteQuery, [vacantePracticaID]);
            res.status(200).send({ message: 'Vacante eliminada con éxito' });
        } else {
            res.status(403).send({ message: 'Solo se pueden eliminar elementos aceptados' });
        }
    } catch (err) {
        console.error('Error en el servidor:', err);
        return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
    }
});

// Endpoint para eliminar una vacante junto con sus postulaciones
app.delete('/vacantePractica/:id', async (req, res) => {
    const vacanteID = req.params.id;

    try {
        // Primero, elimina todas las postulaciones asociadas a esta vacante
        const deletePostulacionesQuery = 'DELETE FROM postulacionAlumno WHERE vacanteID = ?';
        await pool.query(deletePostulacionesQuery, [vacanteID]);

        // Luego, elimina la vacante
        const deleteVacanteQuery = 'DELETE FROM vacantePractica WHERE vacantePracticaID = ?';
        await pool.query(deleteVacanteQuery, [vacanteID]);

        res.status(200).send({ message: 'Vacante y sus postulaciones eliminadas con éxito' });
    } catch (error) {
        console.error('Error al eliminar la vacante y sus postulaciones:', error);
        res.status(500).send({ message: 'Error al eliminar la vacante y sus postulaciones: ' + error.message });
    }
});

// Endpoint para rechazar una postulación (eliminarla de la base de datos)
app.delete('/postulacion/:id', async (req, res) => {
    const postulacionID = req.params.id;

    try {
        const deletePostulacionQuery = 'DELETE FROM postulacionAlumno WHERE postulacionID = ?';
        await pool.query(deletePostulacionQuery, [postulacionID]);

        res.status(200).send({ message: 'Postulación eliminada con éxito' });
    } catch (error) {
        console.error('Error al eliminar la postulación:', error);
        res.status(500).send({ message: 'Error al eliminar la postulación: ' + error.message });
    }
});

// Eliminar entidad receptora
app.delete('/entidadReceptora/:entidadID', async (req, res) => {
    const entidadID = req.params.entidadID;
    const checkStatusQuery = 'SELECT estatus FROM entidadReceptora WHERE entidadID = ?';
    const deleteQuery = 'DELETE FROM entidadReceptora WHERE entidadID = ?';

    try {
        const [result] = await pool.query(checkStatusQuery, [entidadID]);

        if (result.length > 0 && result[0].estatus === 'Aceptado') {
            await pool.query(deleteQuery, [entidadID]);
            res.status(200).send({ message: 'Entidad eliminada con éxito' });
        } else {
            res.status(403).send({ message: 'Solo se pueden eliminar elementos aceptados' });
        }
    } catch (err) {
        console.error('Error en el servidor:', err);
        return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
    }
});

// ------------------------------ METODOS PUT ------------------------------------------
// Aceptar alumno
app.put('/alumno/aceptar/:numControl', async (req, res) => {
    const numControl = req.params.numControl;
    const query = 'UPDATE alumno SET estatus = "Aceptado" WHERE numControl = ?';

    try {
        await pool.query(query, [numControl]);
        res.status(200).send({ message: 'Alumno aceptado con éxito' });
    } catch (err) {
        console.error('Error en el servidor:', err);
        res.status(500).send({ message: 'Error en el servidor: ' + err.message });
    }
});

// Rechazar alumno
app.put('/alumno/rechazar/:numControl', async (req, res) => {
    const numControl = req.params.numControl;
    const query = 'UPDATE alumno SET estatus = "Rechazado" WHERE numControl = ?';

    try {
        await pool.query(query, [numControl]);
        res.status(200).send({ message: 'Alumno rechazado con éxito' });
    } catch (err) {
        console.error('Error en el servidor:', err);
        res.status(500).send({ message: 'Error en el servidor: ' + err.message });
    }
});

// Aceptar vacante
app.put('/vacantePractica/aceptar/:vacantePracticaID', async (req, res) => {
    const vacantePracticaID = req.params.vacantePracticaID;
    const query = 'UPDATE vacantePractica SET estatus = "Aceptado" WHERE vacantePracticaID = ?';

    try {
        await pool.query(query, [vacantePracticaID]);
        res.status(200).send({ message: 'Vacante aceptada con éxito' });
    } catch (err) {
        console.error('Error en el servidor:', err);
        res.status(500).send({ message: 'Error en el servidor: ' + err.message });
    }
});

// Rechazar vacante
app.put('/vacantePractica/rechazar/:vacantePracticaID', async (req, res) => {
    const vacantePracticaID = req.params.vacantePracticaID;
    const query = 'UPDATE vacantePractica SET estatus = "Rechazado" WHERE vacantePracticaID = ?';

    try {
        await pool.query(query, [vacantePracticaID]);
        res.status(200).send({ message: 'Vacante rechazada con éxito' });
    } catch (err) {
        console.error('Error en el servidor:', err);
        res.status(500).send({ message: 'Error en el servidor: ' + err.message });
    }
});

// Aceptar entidad receptora
app.put('/entidadReceptora/aceptar/:entidadID', async (req, res) => {
    const entidadID = req.params.entidadID;
    const query = 'UPDATE entidadReceptora SET estatus = "Aceptado" WHERE entidadID = ?';

    try {
        await pool.query(query, [entidadID]);
        res.status(200).send({ message: 'Entidad aceptada con éxito' });
    } catch (err) {
        console.error('Error en el servidor:', err);
        res.status(500).send({ message: 'Error en el servidor: ' + err.message });
    }
});

// Rechazar entidad receptora
app.put('/entidadReceptora/rechazar/:entidadID', async (req, res) => {
    const entidadID = req.params.entidadID;
    const query = 'UPDATE entidadReceptora SET estatus = "Rechazado" WHERE entidadID = ?';

    try {
        await pool.query(query, [entidadID]);
        res.status(200).send({ message: 'Entidad rechazada con éxito' });
    } catch (err) {
        console.error('Error en el servidor:', err);
        res.status(500).send({ message: 'Error en el servidor: ' + err.message });
    }
});

// Actualizar una vacante
app.put('/vacantePractica/:id', async (req, res) => {
    const { id } = req.params;
    const { titulo, fechaInicio, fechaFinal, ciudad, tipoTrabajo, descripcion } = req.body;
  
    if (!titulo || !fechaInicio || !fechaFinal || !ciudad || !tipoTrabajo || !descripcion) {
        return res.status(400).send({ message: 'Todos los campos son requeridos' });
    }
  
    const query = 'UPDATE vacantePractica SET titulo = ?, fechaInicio = ?, fechaFinal = ?, ciudad = ?, tipoTrabajo = ?, descripcion = ? WHERE vacantePracticaID = ?';
    const values = [titulo, fechaInicio, fechaFinal, ciudad, tipoTrabajo, descripcion, id];
  
    try {
        const [results] = await pool.query(query, values);
        if (results.affectedRows === 0) {
            return res.status(404).send({ message: 'Vacante no encontrada' });
        }
        res.status(200).send({ message: 'Vacante actualizada con éxito' });
    } catch (error) {
        console.error('Error updating vacante:', error);
        return res.status(500).send({ message: 'Error al actualizar la vacante', error: error.message });
    }
});

// Actualizar una entidad receptora
app.put('/entidadReceptora/:id', upload.single('foto'), async (req, res) => {
    const entidadID = req.params.id;
    const { nombreEntidad, nombreUsuario, direccion, categoria, correo, numCelular } = req.body;
    const fotoPerfil = req.file ? req.file.buffer : null;

    let query = 'UPDATE entidadReceptora SET ';
    let fields = [];
    let values = [];

    if (nombreEntidad) fields.push('nombreEntidad = ?'), values.push(nombreEntidad);
    if (nombreUsuario) fields.push('nombreUsuario = ?'), values.push(nombreUsuario);
    if (direccion) fields.push('direccion = ?'), values.push(direccion);
    if (categoria) fields.push('categoria = ?'), values.push(categoria);
    if (correo) fields.push('correo = ?'), values.push(correo);
    if (numCelular) fields.push('numCelular = ?'), values.push(numCelular);
    if (fotoPerfil) fields.push('fotoPerfil = ?'), values.push(fotoPerfil);

    if (fields.length === 0) {
        return res.status(400).send({ message: 'No fields to update' });
    }

    query += fields.join(', ') + ' WHERE entidadID = ?';
    values.push(entidadID);

    try {
        const [result] = await pool.query(query, values);
        res.status(200).send({ message: 'Entidad actualizada con éxito' });
    } catch (err) {
        console.error('Error updating data:', err);
        res.status(500).send({ message: 'Error en el servidor' });
    }
});

// Actualizar un alumno
app.put('/alumno/:numControl', upload.single('foto'), async (req, res) => {
    const numControl = req.params.numControl;
    const { nombre, apellidoPaterno, apellidoMaterno, fechaNacimiento, carrera, semestre, turno, correo, numCelular } = req.body;
    const fotoPerfil = req.file ? req.file.buffer : null;

    let query = 'UPDATE alumno SET ';
    let fields = [];
    let values = [];

    if (nombre) fields.push('nombre = ?'), values.push(nombre);
    if (apellidoPaterno) fields.push('apellidoPaterno = ?'), values.push(apellidoPaterno);
    if (apellidoMaterno) fields.push('apellidoMaterno = ?'), values.push(apellidoMaterno);
    if (fechaNacimiento) fields.push('fechaNacimiento = ?'), values.push(fechaNacimiento);
    if (carrera) fields.push('carrera = ?'), values.push(carrera);
    if (semestre) fields.push('semestre = ?'), values.push(semestre);
    if (turno) fields.push('turno = ?'), values.push(turno);
    if (correo) fields.push('correo = ?'), values.push(correo);
    if (numCelular) fields.push('numCelular = ?'), values.push(numCelular);
    if (fotoPerfil) fields.push('fotoPerfil = ?'), values.push(fotoPerfil);

    if (fields.length === 0) {
        return res.status(400).send({ message: 'No fields to update' });
    }

    query += fields.join(', ') + ' WHERE numControl = ?';
    values.push(numControl);

    try {
        const [result] = await pool.query(query, values);
        res.status(200).send({ message: 'Alumno actualizado con éxito' });
    } catch (err) {
        console.error('Error updating data:', err);
        res.status(500).send({ message: 'Error en el servidor' });
    }
});

// Actualizar un asesor interno
app.put('/asesorInterno/:id', upload.single('foto'), async (req, res) => {
    const id = req.params.id;
    const { nombre, apellidoPaterno, apellidoMaterno, correo, numCelular } = req.body;
    const fotoPerfil = req.file ? req.file.buffer : null;

    let query = 'UPDATE asesorInterno SET ';
    let fields = [];
    let values = [];

    if (nombre) fields.push('nombre = ?'), values.push(nombre);
    if (apellidoPaterno) fields.push('apellidoPaterno = ?'), values.push(apellidoPaterno);
    if (apellidoMaterno) fields.push('apellidoMaterno = ?'), values.push(apellidoMaterno);
    if (correo) fields.push('correo = ?'), values.push(correo);
    if (numCelular) fields.push('numCelular = ?'), values.push(numCelular);
    if (fotoPerfil) fields.push('fotoPerfil = ?'), values.push(fotoPerfil);

    if (fields.length === 0) {
        return res.status(400).send({ message: 'No fields to update' });
    }

    query += fields.join(', ') + ' WHERE asesorInternoID = ?';
    values.push(id);

    try {
        const [result] = await pool.query(query, values);
        res.status(200).send({ message: 'Asesor Interno actualizado con éxito' });
    } catch (err) {
        console.error('Error updating data:', err);
        res.status(500).send({ message: 'Error en el servidor' });
    }
});
