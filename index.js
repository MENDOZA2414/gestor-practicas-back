const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require('mysql');
const multer = require('multer');
const md5 = require('md5');
const app = express();

const PORT = process.env.PORT || 3001;
const MYSQLHOST = process.env.MYSQLHOST || 'localhost';
const MYSQLUSER = process.env.MYSQLUSER || 'root';
const MYSQLPASSWORD = process.env.MYSQLPASSWORD || 'Jm241410';
const MYSQLDATABASE = process.env.MYSQLDATABASE || 'sistemaPracticas';
const MYSQLPORT = process.env.MYSQLPORT || 3306;

const dbConfig = {
    host: MYSQLHOST,
    user: MYSQLUSER,
    password: MYSQLPASSWORD,
    database: MYSQLDATABASE,
    port: MYSQLPORT,
    connectTimeout: 100000,
    acquireTimeout: 100000,
};

let connection;

function handleDisconnect() {
    connection = mysql.createConnection(dbConfig);

    connection.connect((err) => {
        if (err) {
            console.error('Error connecting to MySQL:', err);
            setTimeout(handleDisconnect, 2000); // Reintentar después de 2 segundos
        }
    });

    connection.on('error', (err) => {
        console.error('MySQL error:', err);
        if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET') {
            handleDisconnect(); 
        } else {
            throw err;
        }
    });
}

handleDisconnect();

app.use(cors());
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));


app.listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);
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
app.get('/checkDbChanges', (req, res) => {
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

    connection.query(query, (err, results) => {
        if (err) {
            console.error('Error checking for changes:', err);
            return res.status(500).send({ message: 'Error checking for changes' });
        }

        const hasChanges = results.length > 0;
        const changeTypes = results.map(result => result.usuarioTipo);
        res.json({ hasChanges, changeTypes });
    });
});

// Ruta para obtener un alumno por número de control
app.get('/alumno/:numControl', (req, res) => {
    const numControl = req.params.numControl;
    connection.query(`SELECT * FROM alumno WHERE numControl = ?`, [numControl],
        (err, result) => {
            if (result.length > 0) {
                const alumno = result[0];
                if (alumno.fotoPerfil) {
                    alumno.fotoPerfil = alumno.fotoPerfil.toString('base64');
                }
                res.status(200).send(alumno);
            } else {
                res.status(400).send({
                    message: 'No existe el alumno'
                });
            }
        }
    );
});

app.get('/image/:numControl', (req, res) => {
    const numControl = req.params.numControl;
    const query = 'SELECT fotoPerfil FROM alumno WHERE numControl = ?';

    connection.query(query, [numControl], (err, results) => {
        if (err) {
            console.error('Error fetching image:', err);
            return res.status(500).send({ message: 'Error fetching image', error: err });
        }
        if (results.length === 0 || !results[0].fotoPerfil) {
            return res.status(404).send({ message: 'Image not found' });
        }
        res.type('image/jpeg');
        res.send(results[0].fotoPerfil);
    });
});

app.get('/aplicaciones/:vacanteID', (req, res) => {
    const vacanteID = req.params.vacanteID;
    connection.query(`
        SELECT P.*, V.titulo AS vacanteTitulo
        FROM postulacionalumno P
        INNER JOIN vacantePractica V ON P.vacanteID = V.vacantePracticaID
        WHERE P.vacanteID = ?`, [vacanteID], 
        (err, result) => {
            if (err) {
                console.error('Error en la consulta:', err);
                return res.status(500).send({ message: 'Error en el servidor', error: err });
            }
            if (result.length > 0) {
                res.status(200).send(result.map(postulacion => ({
                    ...postulacion,
                    cartaPresentacion: Buffer.from(postulacion.cartaPresentacion).toString('base64') // Convierte a base64
                })));
            } else {
                res.status(404).send({ message: 'No hay postulaciones' });
            }
        });
});

app.get('/postulacionalumno/:id', (req, res) => {
    const documentoID = req.params.id;
    const query = 'SELECT cartaPresentacion FROM postulacionalumno WHERE postulacionID = ?'; // Cambiado 'id' por 'postulacionID'

    connection.query(query, [documentoID], (err, result) => {
        if (err) {
            return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
        }
        if (result.length > 0) {
            const documento = result[0];
            res.setHeader('Content-Type', 'application/pdf');
            res.send(Buffer.from(documento.cartaPresentacion, 'binary'));
        } else {
            res.status(404).send({ message: 'Documento no encontrado' });
        }
    });
});

app.get('/checkPostulacion/:alumnoID/:vacanteID', (req, res) => {
    const { alumnoID, vacanteID } = req.params;
    connection.query(
        'SELECT COUNT(*) as count FROM postulacionAlumno WHERE alumnoID = ? AND vacanteID = ?',
        [alumnoID, vacanteID],
        (err, results) => {
            if (err) {
                console.error('Error verificando postulación:', err);
                res.status(500).json({ error: 'Error verificando postulación' });
            } else {
                const alreadyApplied = results[0].count > 0;
                res.json({ aplicado: alreadyApplied });
            }
        }
    );
});

app.get('/postulaciones/:alumnoID', (req, res) => {
    const alumnoID = req.params.alumnoID;
    connection.query(
        'SELECT vacanteID FROM postulacionAlumno WHERE alumnoID = ?',
        [alumnoID],
        (err, results) => {
            if (err) {
                console.error('Error obteniendo postulaciones:', err);
                res.status(500).json({ error: 'Error obteniendo postulaciones' });
            } else {
                res.json(results);
            }
        }
    );
});

// Ruta para obtener un asesor interno por ID
app.get('/asesorInterno/:id', (req, res) => {
    const asesorInternoID = req.params.id;
    connection.query(`SELECT * FROM asesorInterno WHERE asesorInternoID = ?`, [asesorInternoID],
        (err, result) => {
            if (result.length > 0) {
                const asesor = result[0];
                if (asesor.fotoPerfil) {
                    asesor.fotoPerfil = asesor.fotoPerfil.toString('base64');
                }
                res.status(200).send(asesor);
            } else {
                res.status(400).send({
                    message: 'No existe el asesor interno'
                });
            }
        }
    );
  });
  
// Ruta para obtener una entidad receptora por ID
app.get('/entidadReceptora/:id', (req, res) => {
    const entidadID = req.params.id;
    connection.query(`SELECT * FROM entidadReceptora WHERE entidadID = ?`, [entidadID],
      (err, result) => {
        if (result.length > 0) {
          const entidad = result[0];
          if (entidad.fotoPerfil) {
            entidad.fotoPerfil = entidad.fotoPerfil.toString('base64');
          }
          res.status(200).send(entidad);
        } else {
          res.status(400).send({
            message: 'No existe la entidad receptora'
          });
        }
      }
    );
});

// Ruta para obtener todos los asesores internos
app.get('/asesoresInternos', (req, res) => {
    connection.query('SELECT asesorInternoID, CONCAT(nombre, " ", apellidoPaterno, " ", apellidoMaterno) AS nombreCompleto FROM asesorInterno', (err, results) => {
        if (err) {
            return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
        }
        res.status(200).send(results);
    });
});

// Ruta para obtener la práctica profesional de un alumno por su número de control
app.get('/practicaProfesional/alumno/:numControl', (req, res) => {
    const numControl = req.params.numControl;
    const query = `
        SELECT * FROM practicasProfesionales 
        WHERE alumnoID = ? 
        ORDER BY fechaCreacion DESC LIMIT 1
    `;
    connection.query(query, [numControl], (err, result) => {
        if (err) {
            return res.status(500).send({ message: err.message });
        }
        if (result.length > 0) {
            res.status(200).send(result[0]);
        } else {
            res.status(404).send({ message: 'No se encontró una práctica profesional para este alumno' });
        }
    });
});

app.get('/asesorExterno/:id', (req, res) => {
    const asesorExternoID = req.params.id;
    connection.query(`SELECT * FROM asesorExterno WHERE asesorExternoID = ?`, [asesorExternoID],
        (err, result) => {
            if (result.length > 0) {
                const asesor = result[0];
                if (asesor.fotoPerfil) {
                    asesor.fotoPerfil = asesor.fotoPerfil.toString('base64');
                }
                res.status(200).send(asesor);
            } else {
                res.status(400).send({
                    message: 'No existe el asesor externo'
                });
            }
        }
    );
});

// Ruta para obtener todos los documentos de un alumno
app.get('/documentoAlumnoSubidos/:alumnoID', (req, res) => {
    const alumnoID = req.params.alumnoID;
    const query = 'SELECT documentoID AS id, nombreArchivo, estatus FROM documentosAlumnoSubido WHERE alumnoID = ?';

    connection.query(query, [alumnoID], (err, result) => {
        if (err) {
            return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
        }
        res.status(200).send(result.length > 0 ? result : []); // Enviar un arreglo vacío si no hay documentos
    });
});

// Ruta para obtener todos los documentos enviados de un alumno desde la tabla documentoAlumno
app.get('/documentoAlumnoRegistrado/:alumnoID', (req, res) => {
    const alumnoID = req.params.alumnoID;
    const query = 'SELECT documentoID AS id, nombreArchivo FROM documentoAlumno WHERE alumnoID = ? AND estatus = "En proceso"';

    connection.query(query, [alumnoID], (err, result) => {
        if (err) {
            return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
        }
        res.send(result.length > 0 ? result : []);
    });
});

// Ruta para obtener un documento PDF desde la tabla documentosAlumnoSubido
app.get('/documentoAlumnoSubido/:id', (req, res) => {
    const documentoID = req.params.id;
    const query = 'SELECT archivo, nombreArchivo FROM documentosAlumnoSubido WHERE documentoID = ?';

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

// Ruta para obtener todos los documentos de un alumno desde la tabla documentoAlumno
app.get('/documentoAlumnoRegistrado/:alumnoID', (req, res) => {
    const alumnoID = req.params.alumnoID;
    const query = 'SELECT documentoID AS id, nombreArchivo FROM documentoAlumno WHERE alumnoID = ? AND estatus = "En proceso"';

    connection.query(query, [alumnoID], (err, result) => {
        if (err) {
            return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
        }
        res.send(result.length > 0 ? result : []);
    });
});

// Ruta para obtener los documentos aprobados de un alumno
app.get('/documentoAlumnoAprobado/:alumnoID', (req, res) => {
    const alumnoID = req.params.alumnoID;
    const query = 'SELECT documentoID AS id, nombreArchivo FROM documentoAlumno WHERE alumnoID = ? AND estatus = "Aceptado"';

    connection.query(query, [alumnoID], (err, result) => {
        if (err) {
            return res.status(500).send({ message: 'Error fetching approved documents' });
        }
        res.send(result.length > 0 ? result : []);
    });
});

// Obtener todas las entidades
app.get('/entidades/all', (req, res) => {
    const query = 'SELECT entidadID, nombreEntidad AS nombre, fotoPerfil AS logoEmpresa FROM entidadReceptora ORDER BY nombreEntidad';
    connection.query(query, (err, results) => {
      if (err) {
        return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
      }
      results.forEach(row => {
        if (row.logoEmpresa) {
          row.logoEmpresa = `data:image/jpeg;base64,${Buffer.from(row.logoEmpresa).toString('base64')}`;
        }
      });
      res.status(200).send(results);
    });
});

// Ruta para obtener los alumnos asignados a un asesor
app.get('/alumnos/:asesorID', (req, res) => {
    const asesorID = req.params.asesorID;
    console.log(`Received request to fetch students for asesorID: ${asesorID}`);

    const query = 'SELECT numControl, nombre, turno, carrera, fotoPerfil FROM alumno WHERE asesorInternoID = ?';

    connection.query(query, [asesorID], (err, results) => {
        if (err) {
            console.error('Error fetching students:', err);
            return res.status(500).send({ message: 'Error fetching students', error: err });
        }
        if (results.length === 0) {
            console.log('No students found for asesorID:', asesorID);
            return res.status(404).send({ message: 'No students found' });
        }
        console.log(`Found ${results.length} students for asesorID: ${asesorID}`);
        res.send(results);
    });
});

// Obtener todos los alumnos
app.get('/alumnos/all', (req, res) => {
    const asesorInternoID = req.query.asesorInternoID; // Obtener el ID del asesor interno del query parameter
    console.log('asesorInternoID recibido:', asesorInternoID);

    if (!asesorInternoID) {
        return res.status(400).send({ message: 'asesorInternoID es requerido' });
    }

    const query = 'SELECT numControl, CONCAT(nombre, " ", apellidoPaterno, " ", apellidoMaterno) AS nombre, fotoPerfil FROM alumno WHERE asesorInternoID = ? ORDER BY nombre';
    
    connection.query(query, [asesorInternoID], (err, results) => {
        if (err) {
            console.error('Error en la consulta SQL:', err.message);
            return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
        }
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
    });
});

app.get('/vacantesPractica/:id', (req, res) => {
    const vacantePracticaID = req.params.id;
    connection.query('SELECT * FROM vacantePractica WHERE vacantePracticaID = ?', [vacantePracticaID],
        (err, result) => {
            if (err) {
                console.error(err);
                res.status(500).send({ message: 'Error en el servidor' });
            } else if (result.length > 0) {
                let vacante = result[0];
                if (vacante.logoEmpresa) {
                    vacante.logoEmpresa = `data:image/jpeg;base64,${Buffer.from(vacante.logoEmpresa).toString('base64')}`;
                }
                res.status(200).json(vacante);
            } else {
                res.status(400).send({ message: 'No existe la vacante' });
            }
        }
    );
});

app.get('/vacantePractica/:entidadID', (req, res) => {
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

    connection.query(query, [entidadID], (err, result) => {
        if (err) {
            res.status(500).send({
                message: err.message
            });
        } else {
            result.forEach(row => {
                if (row.logoEmpresa) {
                    row.logoEmpresa = `data:image/jpeg;base64,${Buffer.from(row.logoEmpresa).toString('base64')}`;
                }
            });
            res.status(200).send(result);
        }
    });
});

// Obtener todas las vacantes prácticas
app.get('/vacantePractica/all/:page/:limit', (req, res) => {
    const page = req.params.page;
    const limit = req.params.limit;
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
  
    connection.query(query, [start, parseInt(limit)], (err, result) => {
      if (err) {
        res.status(500).send({
          message: err.message
        });
      } else {
        result.forEach(row => {
          if (row.logoEmpresa) {
            row.logoEmpresa = `data:image/jpeg;base64,${Buffer.from(row.logoEmpresa).toString('base64')}`;
          }
        });
        res.status(200).send(result);
      }
    });
});

 // Obtener alumnos por estatus y asesorInternoID
 app.get('/alumnos', (req, res) => {
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

    connection.query(query, params, (err, results) => {
        if (err) {
            console.error('Error fetching students:', err);
            return res.status(500).send({ message: 'Error en el servidor' });
        }

        if (results.length === 0) {
            return res.status(404).send({ message: 'No students found' });
        }

        results = results.map(student => ({
            ...student,
            fotoPerfil: student.fotoPerfil ? `data:image/jpeg;base64,${Buffer.from(student.fotoPerfil).toString('base64')}` : null
        }));

        res.status(200).send(results);
    });
});

// Obtener vacantes por estatus
app.get('/vacantePractica', (req, res) => {
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

    connection.query(query, params, (err, results) => {
        if (err) {
            console.error('Error fetching internships:', err);
            return res.status(500).send({ message: 'Error en el servidor' });
        }

        results.forEach(row => {
            if (row.logoEmpresa) {
                row.logoEmpresa = `data:image/jpeg;base64,${Buffer.from(row.logoEmpresa).toString('base64')}`;
            }
        });

        res.status(200).send(results);
    });
});

// Obtener entidades por estatus
app.get('/entidades', (req, res) => {
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

    connection.query(query, params, (err, results) => {
        if (err) {
            console.error('Error fetching entities:', err);
            return res.status(500).send({ message: 'Error en el servidor' });
        }

        results.forEach(row => {
            if (row.logoEmpresa) {
                row.logoEmpresa = `data:image/jpeg;base64,${Buffer.from(row.logoEmpresa).toString('base64')}`;
            }
        });

        res.status(200).send(results);
    });
});

app.get('/practicas/:entidadID', (req, res) => {
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
            practicasprofesionales pp
        JOIN alumno a ON pp.alumnoID = a.numControl
        JOIN asesorExterno ae ON pp.asesorExternoID = ae.asesorExternoID
        WHERE
            pp.entidadID = ?;
    `;

    connection.query(query, [entidadID], (err, results) => {
        if (err) {
            return res.status(500).json({ message: 'Error fetching practicas profesionales', error: err });
        }
        res.json(results);
    });
});

// Ruta para obtener la práctica profesional de un alumno por su alumnoID
app.get('/practica/alumno/:alumnoID', (req, res) => {
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
            practicasprofesionales pp
        JOIN alumno a ON pp.alumnoID = a.numControl
        JOIN asesorExterno ae ON pp.asesorExternoID = ae.asesorExternoID
        JOIN entidadReceptora er ON pp.entidadID = er.entidadID
        WHERE
            a.numControl = ?;
    `;

    connection.query(query, [alumnoID], (err, results) => {
        if (err) {
            return res.status(500).json({ message: 'Error fetching practica profesional', error: err });
        }
        if (results.length === 0) {
            return res.status(404).json({ message: 'No practica profesional found for this alumnoID' });
        }
        res.json(results[0]);
    });
});

// Ruta para obtener todos los formatos con el contenido del archivo PDF
app.get('/api/formatos', (req, res) => {
    const query = 'SELECT documentoID, nombreArchivo, archivo FROM formatos';
    connection.query(query, (err, results) => {
        if (err) {
            return res.status(500).json({ message: 'Error fetching formatos', error: err });
        }
        
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
    });
});

// ------------------------------ METODOS POST ------------------------------------------
app.post('/vacantePractica', (req, res) => {
    const { titulo, fechaInicio, fechaFinal, ciudad, tipoTrabajo, descripcion, entidadID, asesorExternoID } = req.body;

    if (!entidadID) {
        return res.status(400).send({
            message: "El campo 'entidadID' es requerido."
        });
    }

    connection.query(`INSERT INTO vacantePractica (titulo, fechaInicio, fechaFinal, ciudad, tipoTrabajo, descripcion, entidadID, asesorExternoID) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [titulo, fechaInicio, fechaFinal, ciudad, tipoTrabajo, descripcion, entidadID, asesorExternoID],
        (err, result) => {
            if (err) {
                res.status(400).send({
                    message: err.message
                });
            } else {
                connection.query(`SELECT * FROM vacantePractica WHERE vacantePracticaID = ?`, [result.insertId], (err2, result2) => {
                    if (err2) {
                        res.status(400).send({
                            message: err2.message
                        });
                    } else {
                        res.status(201).send({
                            status: 201,
                            message: 'Vacante creada con éxito',
                            data: result2[0]
                        });
                    }
                });
            }
        });
});

app.post('/checkDuplicateEmail', (req, res) => {
    const { correo } = req.body;
    const queries = [
        `SELECT correo FROM entidadReceptora WHERE correo = ?`,
        `SELECT correo FROM alumno WHERE correo = ?`,
        `SELECT correo FROM asesorInterno WHERE correo = ?`,
        `SELECT correo FROM asesorExterno WHERE correo = ?`,
        `SELECT correo FROM administrador WHERE correo = ?`
    ];

    const checkDuplicate = (query, callback) => {
        connection.query(query, [correo], (err, result) => {
            if (err) {
                callback(err, null);
            } else if (result.length > 0) {
                callback(null, true);
            } else {
                callback(null, false);
            }
        });
    };

    let foundDuplicate = false;
    let checkedCount = 0;

    queries.forEach((query) => {
        checkDuplicate(query, (err, exists) => {
            if (err) {
                return res.status(500).send({
                    message: 'Error en el servidor'
                });
            }
            checkedCount++;
            if (exists && !foundDuplicate) {
                foundDuplicate = true;
                return res.status(200).send({
                    exists: true
                });
            }
            if (checkedCount === queries.length && !foundDuplicate) {
                return res.status(200).send({
                    exists: false
                });
            }
        });
    });
});

app.post('/checkDuplicatePhone', (req, res) => {
    const { numCelular } = req.body;
    const queries = [
        `SELECT numCelular FROM entidadReceptora WHERE numCelular = ?`,
        `SELECT numCelular FROM alumno WHERE numCelular = ?`,
        `SELECT numCelular FROM asesorInterno WHERE numCelular = ?`,
        `SELECT numCelular FROM asesorExterno WHERE numCelular = ?`,
        `SELECT numCelular FROM administrador WHERE numCelular = ?`
    ];

    const checkDuplicate = (query, callback) => {
        connection.query(query, [numCelular], (err, result) => {
            if (err) {
                callback(err, null);
            } else if (result.length > 0) {
                callback(null, true);
            } else {
                callback(null, false);
            }
        });
    };

    let foundDuplicate = false;
    let checkedCount = 0;

    queries.forEach((query) => {
        checkDuplicate(query, (err, exists) => {
            if (err) {
                return res.status(500).send({
                    message: 'Error en el servidor'
                });
            }
            checkedCount++;
            if (exists && !foundDuplicate) {
                foundDuplicate = true;
                return res.status(200).send({
                    exists: true
                });
            }
            if (checkedCount === queries.length && !foundDuplicate) {
                return res.status(200).send({
                    exists: false
                });
            }
        });
    });
});

app.post('/checkDuplicateEmailAlumno', (req, res) => {
    const { correo, numControl } = req.body;
    const queries = [
        `SELECT correo FROM entidadReceptora WHERE correo = ? AND entidadID <> ?`,
        `SELECT correo FROM alumno WHERE correo = ? AND numControl <> ?`,
        `SELECT correo FROM asesorInterno WHERE correo = ? AND asesorInternoID <> ?`,
        `SELECT correo FROM asesorExterno WHERE correo = ? AND asesorExternoID <> ?`,
        `SELECT correo FROM administrador WHERE correo = ? AND adminID <> ?`
    ];

    let foundDuplicate = false;
    let checkedCount = 0;

    const checkDuplicate = (query, callback) => {
        connection.query(query, [correo, numControl], (err, result) => {
            if (err) {
                return callback(err, null);
            } else if (result.length > 0) {
                return callback(null, true);
            } else {
                return callback(null, false);
            }
        });
    };

    queries.forEach((query) => {
        checkDuplicate(query, (err, exists) => {
            if (err) {
                if (!foundDuplicate && checkedCount < queries.length) {
                    foundDuplicate = true;
                    return res.status(500).send({ message: 'Error en el servidor' });
                }
            }
            checkedCount++;
            if (exists && !foundDuplicate) {
                foundDuplicate = true;
                return res.status(200).send({ exists: true });
            }
            if (checkedCount === queries.length && !foundDuplicate) {
                return res.status(200).send({ exists: false });
            }
        });
    });
});

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
            const result = await new Promise((resolve, reject) => {
                connection.query(query, [numCelular, numControl], (err, result) => {
                    if (err) return reject(err);
                    resolve(result);
                });
            });
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

app.post('/checkDuplicateEmailExceptCurrent', (req, res) => {
    const { correo, id } = req.body;

    const queries = [
        `SELECT correo FROM entidadReceptora WHERE correo = ? AND entidadID <> ?`,
        `SELECT correo FROM alumno WHERE correo = ? AND numControl <> ?`,
        `SELECT correo FROM asesorInterno WHERE correo = ? AND asesorInternoID <> ?`,
        `SELECT correo FROM asesorExterno WHERE correo = ? AND asesorExternoID <> ?`,
        `SELECT correo FROM administrador WHERE correo = ? AND adminID <> ?`
    ];

    let foundDuplicate = false;
    let checkedCount = 0;

    const checkDuplicate = (query, callback) => {
        connection.query(query, [correo, id], (err, result) => {
            if (err) {
                return callback(err, null);
            } else if (result.length > 0) {
                return callback(null, true);
            } else {
                return callback(null, false);
            }
        });
    };

    queries.forEach((query) => {
        checkDuplicate(query, (err, exists) => {
            if (err) {
                if (!foundDuplicate && checkedCount < queries.length) {
                    foundDuplicate = true;
                    return res.status(500).send({ message: 'Error en el servidor' });
                }
            }
            checkedCount++;
            if (exists && !foundDuplicate) {
                foundDuplicate = true;
                return res.status(200).send({ exists: true });
            }
            if (checkedCount === queries.length && !foundDuplicate) {
                return res.status(200).send({ exists: false });
            }
        });
    });
});

app.post('/checkDuplicatePhoneExceptCurrent', async (req, res) => {
    const { numCelular, id, userType } = req.body;
  
    const queries = [
      { query: 'SELECT numCelular FROM entidadReceptora WHERE numCelular = ? AND entidadID <> ?', idField: 'entidadID' },
      { query: 'SELECT numCelular FROM alumno WHERE numCelular = ? AND numControl <> ?', idField: 'numControl' },
      { query: 'SELECT numCelular FROM asesorInterno WHERE numCelular = ? AND asesorInternoID <> ?', idField: 'asesorInternoID' },
      { query: 'SELECT numCelular FROM asesorExterno WHERE numCelular = ? AND asesorExternoID <> ?', idField: 'asesorExternoID' },
      { query: 'SELECT numCelular FROM administrador WHERE numCelular = ? AND adminID <> ?', idField: 'adminID' }
    ];
  
    try {
      for (const { query, idField } of queries) {
        const result = await new Promise((resolve, reject) => {
          connection.query(query, [numCelular, id], (err, result) => {
            if (err) return reject(err);
            resolve(result);
          });
        });
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
app.post('/registerPostulacion', pdfUpload.single('cartaPresentacion'), (req, res) => {
    const { alumnoID, vacanteID } = req.body;
    const cartaPresentacion = req.file ? req.file.buffer : null;

    if (!alumnoID || !vacanteID || !cartaPresentacion) {
        return res.status(400).send({
            status: 400,
            message: 'Todos los campos son obligatorios'
        });
    }

    connection.query(`SELECT nombre, correo FROM alumno WHERE numControl = ?`, [alumnoID], (err, result) => {
        if (err) {
            return res.status(400).send({
                status: 400,
                message: err.message
            });
        }

        if (result.length === 0) {
            return res.status(404).send({
                status: 404,
                message: 'Alumno no encontrado'
            });
        }

        const { nombre, correo } = result[0];

        connection.query(`INSERT INTO postulacionAlumno (alumnoID, vacanteID, nombreAlumno, correoAlumno, cartaPresentacion) VALUES (?, ?, ?, ?, ?)`,
            [alumnoID, vacanteID, nombre, correo, cartaPresentacion],
            (err, result) => {
                if (err) {
                    return res.status(400).send({
                        status: 400,
                        message: err.message
                    });
                } else {
                    return res.status(201).send({
                        status: 201,
                        message: 'Postulación registrada con éxito',
                        data: { insertId: result.insertId }
                    });
                }
            }
        );
    });
});

app.post('/asesorInterno', upload.single('fotoPerfil'), (req, res) => {
    const { nombre, apellidoPaterno, apellidoMaterno, correo, contraseña, numCelular } = req.body;
    const fotoPerfil = req.file ? req.file.buffer : null;

    connection.query(`INSERT INTO asesorInterno (nombre, apellidoPaterno, apellidoMaterno, correo, contraseña, numCelular, fotoPerfil) VALUES (?, ?, ?, ?, md5(?), ?, ?)`,
        [nombre, apellidoPaterno, apellidoMaterno, correo, contraseña, numCelular, fotoPerfil],
        (err, result) => {
            if (err) {
                res.status(400).send({
                    message: err.message
                });
            } else {
                res.status(201).send({
                    status: 201,
                    message: 'Asesor interno registrado con éxito',
                    data: { insertId: result.insertId }
                });
            }
        });
});

// Ruta para registrar una entidad receptora
app.post('/register/entidadReceptora', upload.single('fotoPerfil'), (req, res) => {
    const { nombreEntidad, nombreUsuario, direccion, categoria, correo, password, numCelular } = req.body;
    const fotoPerfil = req.file ? req.file.buffer : null;

    if (!nombreEntidad || !nombreUsuario || !direccion || !categoria || !correo || !password || !numCelular) {
        return res.status(400).send({
            status: 400,
            message: 'Todos los campos son obligatorios'
        });
    }

    connection.query(`INSERT INTO entidadReceptora (nombreEntidad, nombreUsuario, direccion, categoria, correo, contraseña, numCelular, fotoPerfil) VALUES (?, ?, ?, ?, ?, md5(?), ?, ?)`,
        [nombreEntidad, nombreUsuario, direccion, categoria, correo, password, numCelular, fotoPerfil],
        (err, result) => {
            if (err) {
                res.status(400).send({
                    status: 400,
                    message: err.message
                });
            } else {
                res.status(201).send({
                    status: 201,
                    message: 'Entidad receptora registrada con éxito',
                    data: { insertId: result.insertId }
                });
            }
        }
    );
});

// Registro de alumnos
app.post('/register/alumno', upload.single('foto'), (req, res) => {
    const { numeroControl, nombre, apellidoPaterno, apellidoMaterno, fechaNacimiento, carrera, semestre, turno, email, password, celular, asesorInternoID } = req.body;
    const foto = req.file ? req.file.buffer : null;

    if (!numeroControl || !nombre || !apellidoPaterno || !apellidoMaterno || !fechaNacimiento || !carrera || !semestre || !turno || !email || !password || !celular) {
        return res.status(400).send({
            status: 400,
            message: 'Todos los campos son obligatorios'
        });
    }

    connection.query(`INSERT INTO alumno (numControl, nombre, apellidoPaterno, apellidoMaterno, fechaNacimiento, carrera, semestre, turno, correo, contraseña, numCelular, fotoPerfil, asesorInternoID) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, md5(?), ?, ?, ?)`,
        [numeroControl, nombre, apellidoPaterno, apellidoMaterno, fechaNacimiento, carrera, semestre, turno, email, password, celular, foto, asesorInternoID],
        (err, result) => {
            if (err) {
                return res.status(400).send({
                    status: 400,
                    message: err.message
                });
            } else {
                return res.status(201).send({
                    status: 201,
                    message: 'Alumno registrado con éxito',
                    data: { insertId: result.insertId }
                });
            }
        }
    );
});

// Ruta para registrar un asesor interno
app.post('/register/asesorInterno', upload.single('fotoPerfil'), (req, res) => {
    const { nombre, apellidoPaterno, apellidoMaterno, correo, password, numCelular } = req.body;
    const fotoPerfil = req.file ? req.file.buffer : null;

    if (!nombre || !apellidoPaterno || !apellidoMaterno || !correo || !password || !numCelular) {
        return res.status(400).send({
            status: 400,
            message: 'Todos los campos son obligatorios'
        });
    }

    connection.query(`INSERT INTO asesorInterno (nombre, apellidoPaterno, apellidoMaterno, correo, contraseña, numCelular, fotoPerfil) VALUES (?, ?, ?, ?, md5(?), ?, ?)`,
        [nombre, apellidoPaterno, apellidoMaterno, correo, password, numCelular, fotoPerfil],
        (err, result) => {
            if (err) {
                return res.status(400).send({
                    status: 400,
                    message: err.message
                });
            } else {
                return res.status(201).send({
                    status: 201,
                    message: 'Asesor interno registrado con éxito',
                    data: { insertId: result.insertId }
                });
            }
        }
    );
});

// Ruta para registrar un asesor externo
app.post('/register/asesorExterno', upload.single('fotoPerfil'), (req, res) => {
    const { nombre, apellidoPaterno, apellidoMaterno, correo, password, numCelular, entidadID } = req.body;
    const fotoPerfil = req.file ? req.file.buffer : null;

    if (!nombre || !apellidoPaterno || !apellidoMaterno || !correo || !password || !numCelular || !entidadID) {
        return res.status(400).send({
            status: 400,
            message: 'Todos los campos son obligatorios'
        });
    }

    connection.query(`INSERT INTO asesorExterno (nombre, apellidoPaterno, apellidoMaterno, correo, contraseña, numCelular, fotoPerfil, entidadID) VALUES (?, ?, ?, ?, md5(?), ?, ?, ?)`,
        [nombre, apellidoPaterno, apellidoMaterno, correo, password, numCelular, fotoPerfil, entidadID],
        (err, result) => {
            if (err) {
                return res.status(400).send({
                    status: 400,
                    message: err.message
                });
            } else {
                return res.status(201).send({
                    status: 201,
                    message: 'Asesor externo registrado con éxito',
                    data: { insertId: result.insertId }
                });
            }
        }
    );
});

app.post('/login/alumno', (req, res) => {
    const { email, password } = req.body;
    connection.query(`SELECT * FROM alumno WHERE correo = ? AND contraseña = md5(?)`, [email, password], 
        (err, result) => {
            if (err) {
                return res.status(500).send({ message: 'Error en el servidor' });
            }
            if (result.length > 0) {
                const alumno = result[0];
                if (alumno.fotoPerfil) {
                    alumno.fotoPerfil = alumno.fotoPerfil.toString('base64');
                }
                res.status(200).send(alumno);
            } else {
                res.status(401).send({ status: 401, message: 'Correo o contraseña incorrectos' });
            }
        }
    );
});

app.post('/login/entidad', (req, res) => {
    const { email, password } = req.body;
    connection.query(`SELECT * FROM entidadReceptora WHERE correo = ? AND contraseña = md5(?)`, [email, password], 
        (err, result) => {
            if (err) {
                return res.status(500).send({ message: 'Error en el servidor' });
            }
            if (result.length > 0) {
                const entidad = result[0];
                if (entidad.fotoPerfil) {
                    entidad.fotoPerfil = entidad.fotoPerfil.toString('base64');
                }
                res.status(200).send(entidad);
            } else {
                res.status(401).send({ status: 401, message: 'Correo o contraseña incorrectos' });
            }
        }
    );
});

// Ruta para el inicio de sesión de asesor interno
app.post('/login/asesorInterno', (req, res) => {
    const { email, password } = req.body;
    connection.query(`SELECT * FROM asesorInterno WHERE correo = ? AND contraseña = md5(?)`, [email, password], 
      (err, result) => {
        if (err) {
          return res.status(500).send({ message: 'Error en el servidor' });
        }
        if (result.length > 0) {
          const asesor = result[0];
          if (asesor.fotoPerfil) {
            asesor.fotoPerfil = asesor.fotoPerfil.toString('base64');
          }
          res.status(200).send(asesor);
        } else {
          res.status(401).send({ status: 401, message: 'Correo o contraseña incorrectos' });
        }
      }
    );
});

  // Ruta para el inicio de sesión de asesor externo
app.post('/login/asesorExterno', (req, res) => {
    const { email, password } = req.body;
    connection.query(`SELECT * FROM asesorExterno WHERE correo = ? AND contraseña = md5(?)`, [email, password], 
        (err, result) => {
            if (err) {
                return res.status(500).send({ message: 'Error en el servidor' });
            }
            if (result.length > 0) {
                const asesor = result[0];
                if (asesor.fotoPerfil) {
                    asesor.fotoPerfil = asesor.fotoPerfil.toString('base64');
                }
                res.status(200).send(asesor);
            } else {
                res.status(401).send({ status: 401, message: 'Correo o contraseña incorrectos' });
            }
        }
    );
});

// Endpoint para rechazar una postulación
app.post('/rejectPostulacion', (req, res) => {
    const { postulacionID } = req.body;

    const queryDeletePostulacion = `
        DELETE FROM postulacionalumno
        WHERE postulacionID = ?
    `;

    try {
        connection.query(queryDeletePostulacion, [postulacionID], (err, result) => {
            if (err) {
                return res.status(500).send({ message: 'Error al eliminar la postulación: ' + err.message });
            }

            if (result.affectedRows === 0) {
                return res.status(404).send({ message: 'No se encontró la postulación' });
            }

            res.status(200).send({ message: 'Postulación eliminada con éxito' });
        });
    } catch (error) {
        res.status(500).send({ message: 'Error en el servidor al eliminar la postulación', error: error.message });
    }
});

app.post('/acceptPostulacion', async (req, res) => {
    const { postulacionID } = req.body;

    const queryPostulacion = `
        SELECT 
            p.alumnoID, p.vacanteID, p.nombreAlumno, p.correoAlumno,
            v.entidadID, v.asesorExternoID, v.titulo AS tituloVacante,
            v.fechaInicio, v.fechaFinal
        FROM 
            postulacionalumno p
        JOIN 
            vacantePractica v ON p.vacanteID = v.vacantePracticaID
        WHERE 
            p.postulacionID = ?
    `;

    try {
        connection.query(queryPostulacion, [postulacionID], (err, result) => {
            if (err) {
                return res.status(500).send({ message: 'Error al obtener la postulación: ' + err.message });
            }

            if (result.length === 0) {
                return res.status(404).send({ message: 'No se encontró la postulación' });
            }

            const postulacion = result[0];

            const fechaInicio = postulacion.fechaInicio instanceof Date ? postulacion.fechaInicio.toISOString().split('T')[0] : postulacion.fechaInicio;
            const fechaFinal = postulacion.fechaFinal instanceof Date ? postulacion.fechaFinal.toISOString().split('T')[0] : postulacion.fechaFinal;

            const queryInsertPractica = `
                INSERT INTO practicasprofesionales 
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

            connection.query(queryInsertPractica, values, (err, result) => {
                if (err) {
                    return res.status(500).send({ message: 'Error al registrar la práctica profesional: ' + err.message });
                }

                const queryDeletePostulacion = `
                    DELETE FROM postulacionalumno WHERE alumnoID = ?
                `;

                connection.query(queryDeletePostulacion, [postulacion.alumnoID], (err, result) => {
                    if (err) {
                        return res.status(500).send({ message: 'Error al eliminar las postulaciones del alumno: ' + err.message });
                    }

                    const queryDeleteVacante = `
                        DELETE FROM vacantePractica WHERE vacantePracticaID = ?
                    `;

                    connection.query(queryDeleteVacante, [postulacion.vacanteID], (err, result) => {
                        if (err) {
                            return res.status(500).send({ message: 'Error al eliminar la vacante: ' + err.message });
                        }

                        res.status(201).send({ message: 'Práctica profesional registrada, postulaciones eliminadas y vacante eliminada con éxito' });
                    });
                });
            });
        });
    } catch (error) {
        res.status(500).send({ message: 'Error en el servidor al registrar la práctica profesional', error: error.message });
    }
});

app.post('/uploadDocumentoAlumno', pdfUpload.single('file'), (req, res) => {
    const { alumnoID, nombreArchivo, usuarioTipo } = req.body;
    const archivo = req.file.buffer;

    const query = `INSERT INTO documentoAlumno (alumnoID, nombreArchivo, archivo) VALUES (?, ?, ?)`;
    connection.query(query, [alumnoID, nombreArchivo, archivo], (err, result) => {
        if (err) {
            console.error('Error al guardar el documento en la base de datos:', err);
            return res.status(500).send({
                status: 500,
                message: 'Error al guardar el documento en la base de datos: ' + err.message,
            });
        }
        // Insertar registro en la tabla de auditoría
        const auditQuery = `INSERT INTO auditoria (tabla, accion, usuarioTipo) VALUES ('documentoAlumno', 'INSERT', ?)`;
        connection.query(auditQuery, [usuarioTipo], (auditErr, auditResult) => {
            if (auditErr) {
                console.error('Error al registrar en la auditoría:', auditErr);
                return res.status(500).send({
                    status: 500,
                    message: 'Error al registrar en la auditoría: ' + auditErr.message,
                });
            }
            return res.status(201).send({
                status: 201,
                message: 'Documento subido con éxito',
                documentoID: result.insertId,
            });
        });
    });
});

app.post('/uploadDocumentoAlumnoSubido', pdfUpload.single('file'), (req, res) => {
    const { alumnoID, nombreArchivo } = req.body;
    const archivo = req.file.buffer;

    const query = `INSERT INTO documentosAlumnoSubido (alumnoID, nombreArchivo, archivo, estatus) VALUES (?, ?, ?, 'Subido')`;
    connection.query(query, [alumnoID, nombreArchivo, archivo], (err, result) => {
        if (err) {
            console.error('Error al guardar el documento en la base de datos:', err);
            return res.status(500).send({
                status: 500,
                message: 'Error al guardar el documento en la base de datos: ' + err.message,
            });
        }
        return res.status(201).send({
            status: 201,
            message: 'Documento subido con éxito',
            documentoID: result.insertId,
        });
    });
});

// Ruta para aprobar un documento
app.post('/documentoAlumno/approve', (req, res) => {
    const { documentId, userType } = req.body;

    const selectQuery = 'SELECT * FROM documentoAlumno WHERE documentoID = ?';
    connection.query(selectQuery, [documentId], (err, results) => {
        if (err) {
            console.error('Error selecting documentoAlumno:', err);
            return res.status(500).send({ message: 'Error selecting document' });
        }

        if (results.length === 0) {
            return res.status(404).send({ message: 'Document not found' });
        }

        const updateQuery = 'UPDATE documentoAlumno SET estatus = "Aceptado", usuarioTipo = ? WHERE documentoID = ?';
        connection.query(updateQuery, [userType, documentId], (err, result) => {
            if (err) {
                console.error('Error approving documentoAlumno:', err);
                return res.status(500).send({ message: 'Error approving document' });
            }

            const updateSubidoQuery = 'UPDATE documentosAlumnoSubido SET estatus = "Aceptado" WHERE nombreArchivo = ? AND alumnoID = ?';
            connection.query(updateSubidoQuery, [results[0].nombreArchivo, results[0].alumnoID], (err, result) => {
                if (err) {
                    console.error('Error updating documentosAlumnoSubido:', err);
                    return res.status(500).send({ message: 'Error updating document status' });
                }

                // Registrar la acción en la tabla de auditoría
                const auditQuery = 'INSERT INTO auditoria (tabla, accion, fecha, usuarioTipo) VALUES (?, ?, ?, ?)';
                connection.query(auditQuery, ['documentoAlumno', 'UPDATE', new Date(), userType], (err, auditResult) => {
                    if (err) {
                        console.error('Error inserting into auditoria:', err);
                        return res.status(500).send({ message: 'Error logging audit' });
                    }

                    res.status(200).send({ message: 'Document approved successfully' });
                });
            });
        });
    });
});

// Ruta para rechazar un documento
app.post('/documentoAlumno/reject', (req, res) => {
    const { documentId, userType } = req.body;  // Asegúrate de que userType se recibe aquí

    const selectQuery = 'SELECT * FROM documentoAlumno WHERE documentoID = ?';
    connection.query(selectQuery, [documentId], (err, results) => {
        if (err) {
            console.error('Error selecting documentoAlumno:', err);
            return res.status(500).send({ message: 'Error selecting document' });
        }

        if (results.length === 0) {
            return res.status(404).send({ message: 'Document not found' });
        }

        const deleteQuery = 'DELETE FROM documentoAlumno WHERE documentoID = ?';
        connection.query(deleteQuery, [documentId], (err, result) => {
            if (err) {
                console.error('Error deleting documentoAlumno:', err);
                return res.status(500).send({ message: 'Error rejecting document' });
            }

            const updateSubidoQuery = 'UPDATE documentosAlumnoSubido SET estatus = "Rechazado" WHERE nombreArchivo = ? AND alumnoID = ?';
            connection.query(updateSubidoQuery, [results[0].nombreArchivo, results[0].alumnoID], (err, result) => {
                if (err) {
                    console.error('Error updating documentosAlumnoSubido:', err);
                    return res.status(500).send({ message: 'Error updating document status' });
                }

                // Registrar la acción en la tabla de auditoría
                const auditQuery = 'INSERT INTO auditoria (tabla, accion, fecha, usuarioTipo) VALUES (?, ?, ?, ?)';
                connection.query(auditQuery, ['documentoAlumno', 'DELETE', new Date(), userType], (err, auditResult) => {
                    if (err) {
                        console.error('Error inserting into auditoria:', err);
                        return res.status(500).send({ message: 'Error logging audit' });
                    }

                    res.status(200).send({ message: 'Document rejected successfully' });
                });
            });
        });
    });
});

// Ruta para enviar un documento de un alumno a la tabla documentoAlumno
app.post('/enviarDocumentoAlumno', (req, res) => {
    const { documentoID, userType } = req.body; // Asegúrate de recibir el userType del frontend
    const selectQuery = 'SELECT * FROM documentosAlumnoSubido WHERE documentoID = ?';

    connection.query(selectQuery, [documentoID], (err, result) => {
        if (err) {
            console.error('Error al recuperar el archivo del documento:', err);
            return res.status(500).send({
                status: 500,
                message: 'Error al recuperar el archivo del documento: ' + err.message,
            });
        }

        if (result.length > 0) {
            const documento = result[0];
            const insertQuery = 'INSERT INTO documentoAlumno (alumnoID, nombreArchivo, archivo, estatus, usuarioTipo) VALUES (?, ?, ?, "En proceso", ?)';

            connection.query(insertQuery, [documento.alumnoID, documento.nombreArchivo, documento.archivo, userType], (err, insertResult) => {
                if (err) {
                    console.error('Error al guardar el documento en la base de datos:', err);
                    return res.status(500).send({
                        status: 500,
                        message: 'Error al guardar el documento en la base de datos: ' + err.message,
                    });
                }

                // Actualizar el estado del documento en documentosAlumnoSubido
                const updateQuery = 'UPDATE documentosAlumnoSubido SET estatus = "En proceso" WHERE documentoID = ?';
                connection.query(updateQuery, [documentoID], (updateErr) => {
                    if (updateErr) {
                        console.error('Error al actualizar el estado del documento:', updateErr);
                        return res.status(500).send({
                            status: 500,
                            message: 'Error al actualizar el estado del documento: ' + updateErr.message,
                        });
                    }

                    return res.status(201).send({
                        status: 201,
                        message: 'Documento enviado con éxito',
                        documentoID: insertResult.insertId,
                    });
                });
            });
        } else {
            return res.status(404).send({
                status: 404,
                message: 'Documento no encontrado',
            });
        }
    });
});

// Ruta para subir un documento a la tabla formatos
app.post('/api/uploadFormato', pdfUpload.single('file'), (req, res) => {
    const { nombreArchivo } = req.body;
    const archivo = req.file.buffer;

    const query = `INSERT INTO formatos (nombreArchivo, archivo) VALUES (?, ?)`;
    connection.query(query, [nombreArchivo, archivo], (err, result) => {
        if (err) {
            console.error('Error al guardar el documento en la base de datos:', err);
            return res.status(500).send({
                status: 500,
                message: 'Error al guardar el documento en la base de datos: ' + err.message,
            });
        }
        return res.status(201).send({
            status: 201,
            message: 'Documento subido con éxito',
            documentoID: result.insertId,
        });
    });
});

// ------------------------------ METODOS PUT ------------------------------------------
app.put('/entidadReceptora/:id', upload.single('foto'), (req, res) => {
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

    connection.query(query, values, (err, result) => {
        if (err) {
            console.error('Error updating data:', err);
            return res.status(500).send({ message: 'Error en el servidor' });
        }
        res.status(200).send({ message: 'Entidad actualizada con éxito' });
    });
});

app.put('/alumno/:numControl', upload.single('foto'), (req, res) => {
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

    connection.query(query, values, (err, result) => {
        if (err) {
            console.error('Error updating data:', err);
            return res.status(500).send({ message: 'Error en el servidor' });
        }
        res.status(200).send({ message: 'Alumno actualizado con éxito' });
    });
});

app.put('/asesorInterno/:id', upload.single('foto'), (req, res) => {
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

  connection.query(query, values, (err, result) => {
    if (err) {
      console.error('Error updating data:', err);
      return res.status(500).send({ message: 'Error en el servidor' });
    }
    res.status(200).send({ message: 'Asesor Interno actualizado con éxito' });
  });
});

// ------------------------------ METODOS DELETE ------------------------------------------
// Ruta para eliminar un documento de la tabla documentoAlumno actualizar el estatus
app.delete('/documentoAlumno/:id', (req, res) => {
    const documentoID = req.params.id;

    // Primero, obtenemos el nombre del archivo desde documentoAlumno usando el documentoID
    const selectQuery = 'SELECT nombreArchivo, alumnoID FROM documentoAlumno WHERE documentoID = ?';

    connection.query(selectQuery, [documentoID], (err, result) => {
        if (err) {
            return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
        }

        if (result.length > 0) {
            const { nombreArchivo, alumnoID } = result[0];

            // Borramos el documento de la tabla documentoAlumno
            const deleteQuery = 'DELETE FROM documentoAlumno WHERE documentoID = ?';

            connection.query(deleteQuery, [documentoID], (err, deleteResult) => {
                if (err) {
                    return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
                }

                if (deleteResult.affectedRows > 0) {
                    // Actualizamos el estatus del documento en documentosAlumnoSubido basado en nombreArchivo y alumnoID
                    const updateQuery = 'UPDATE documentosAlumnoSubido SET estatus = "Eliminado" WHERE nombreArchivo = ? AND alumnoID = ?';

                    connection.query(updateQuery, [nombreArchivo, alumnoID], (err, updateResult) => {
                        if (err) {
                            return res.status(500).send({ message: 'Error actualizando el estatus: ' + err.message });
                        }
                        res.send({ message: 'Documento eliminado con éxito' });
                    });
                } else {
                    res.status(404).send({ message: 'Documento no encontrado' });
                }
            });
        } else {
            res.status(404).send({ message: 'Documento no encontrado' });
        }
    });
});

// Ruta para eliminar un documento de la tabla documentosAlumnoSubido
app.delete('/documentoAlumnoSubido/:id', (req, res) => {
    const documentoID = req.params.id;
    const query = 'DELETE FROM documentosAlumnoSubido WHERE documentoID = ?';

    connection.query(query, [documentoID], (err, result) => {
        if (err) {
            return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
        }
        if (result.affectedRows > 0) {
            res.send({ message: 'Documento eliminado con éxito' });
        } else {
            res.status(404).send({ message: 'Documento no encontrado' });
        }
    });
});

// Eliminar alumno
app.delete('/alumno/:numControl', (req, res) => {
    const numControl = req.params.numControl;

    const checkStatusQuery = 'SELECT estatus FROM alumno WHERE numControl = ?';
    connection.query(checkStatusQuery, [numControl], (err, result) => {
        if (err) {
            return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
        }
        if (result.length > 0 && result[0].estatus === 'Aceptado') {
            const deleteQuery = 'DELETE FROM alumno WHERE numControl = ?';
            connection.query(deleteQuery, [numControl], (err, result) => {
                if (err) {
                    return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
                }
                res.status(200).send({ message: 'Alumno eliminado con éxito' });
            });
        } else {
            res.status(403).send({ message: 'Solo se pueden eliminar elementos aceptados' });
        }
    });
});

// Eliminar vacante
app.delete('/vacantePractica/:vacantePracticaID', (req, res) => {
    const vacantePracticaID = req.params.vacantePracticaID;

    const checkStatusQuery = 'SELECT estatus FROM vacantePractica WHERE vacantePracticaID = ?';
    connection.query(checkStatusQuery, [vacantePracticaID], (err, result) => {
        if (err) {
            return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
        }
        if (result.length > 0 && result[0].estatus === 'Aceptado') {
            const deleteQuery = 'DELETE FROM vacantePractica WHERE vacantePracticaID = ?';
            connection.query(deleteQuery, [vacantePracticaID], (err, result) => {
                if (err) {
                    return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
                }
                res.status(200).send({ message: 'Vacante eliminada con éxito' });
            });
        } else {
            res.status(403).send({ message: 'Solo se pueden eliminar elementos aceptados' });
        }
    });
});

// Endpoint para eliminar una vacante junto con sus postulaciones
app.delete('/vacantePractica/:id', async (req, res) => {
    const vacanteID = req.params.id;

    try {
        // Primero, elimina todas las postulaciones asociadas a esta vacante
        const deletePostulacionesQuery = 'DELETE FROM postulacionalumno WHERE vacanteID = ?';
        await new Promise((resolve, reject) => {
            connection.query(deletePostulacionesQuery, [vacanteID], (err, result) => {
                if (err) {
                    return reject(err);
                }
                resolve(result);
            });
        });

        // Luego, elimina la vacante
        const deleteVacanteQuery = 'DELETE FROM vacantepractica WHERE vacantePracticaID = ?';
        await new Promise((resolve, reject) => {
            connection.query(deleteVacanteQuery, [vacanteID], (err, result) => {
                if (err) {
                    return reject(err);
                }
                resolve(result);
            });
        });

        res.status(200).send({ message: 'Vacante y sus postulaciones eliminadas con éxito' });
    } catch (error) {
        res.status(500).send({ message: 'Error al eliminar la vacante y sus postulaciones: ' + error.message });
    }
});

// Endpoint para rechazar una postulación (eliminarla de la base de datos)
app.delete('/postulacion/:id', async (req, res) => {
    const postulacionID = req.params.id;

    try {
        const deletePostulacionQuery = 'DELETE FROM postulacionalumno WHERE postulacionID = ?';
        await new Promise((resolve, reject) => {
            connection.query(deletePostulacionQuery, [postulacionID], (err, result) => {
                if (err) {
                    return reject(err);
                }
                resolve(result);
            });
        });

        res.status(200).send({ message: 'Postulación eliminada con éxito' });
    } catch (error) {
        res.status(500).send({ message: 'Error al eliminar la postulación: ' + error.message });
    }
});

// Eliminar entidad
app.delete('/entidadReceptora/:entidadID', (req, res) => {
    const entidadID = req.params.entidadID;

    const checkStatusQuery = 'SELECT estatus FROM entidadReceptora WHERE entidadID = ?';
    connection.query(checkStatusQuery, [entidadID], (err, result) => {
        if (err) {
            return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
        }
        if (result.length > 0 && result[0].estatus === 'Aceptado') {
            const deleteQuery = 'DELETE FROM entidadReceptora WHERE entidadID = ?';
            connection.query(deleteQuery, [entidadID], (err, result) => {
                if (err) {
                    return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
                }
                res.status(200).send({ message: 'Entidad eliminada con éxito' });
            });
        } else {
            res.status(403).send({ message: 'Solo se pueden eliminar elementos aceptados' });
        }
    });
});

// ------------------------------ METODOS PUT ------------------------------------------
  // Aceptar alumno
app.put('/alumno/aceptar/:numControl', (req, res) => {
    const numControl = req.params.numControl;
    const query = 'UPDATE alumno SET estatus = "Aceptado" WHERE numControl = ?';
  
    connection.query(query, [numControl], (err, results) => {
      if (err) {
        return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
      }
      res.status(200).send({ message: 'Alumno aceptado con éxito' });
    });
});
  
  // Rechazar alumno
app.put('/alumno/rechazar/:numControl', (req, res) => {
const numControl = req.params.numControl;
const query = 'UPDATE alumno SET estatus = "Rechazado" WHERE numControl = ?';

connection.query(query, [numControl], (err, results) => {
    if (err) {
    return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
    }
    res.status(200).send({ message: 'Alumno rechazado con éxito' });
});
});
  
  // Aceptar vacante
app.put('/vacantePractica/aceptar/:vacantePracticaID', (req, res) => {
    const vacantePracticaID = req.params.vacantePracticaID;
    const query = 'UPDATE vacantePractica SET estatus = "Aceptado" WHERE vacantePracticaID = ?';
  
    connection.query(query, [vacantePracticaID], (err, results) => {
      if (err) {
        return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
      }
      res.status(200).send({ message: 'Vacante aceptada con éxito' });
    });
  });
  
  // Rechazar vacante
app.put('/vacantePractica/rechazar/:vacantePracticaID', (req, res) => {
    const vacantePracticaID = req.params.vacantePracticaID;
    const query = 'UPDATE vacantePractica SET estatus = "Rechazado" WHERE vacantePracticaID = ?';
  
    connection.query(query, [vacantePracticaID], (err, results) => {
      if (err) {
        return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
      }
      res.status(200).send({ message: 'Vacante rechazada con éxito' });
    });
});
  
  // Aceptar entidad
app.put('/entidadReceptora/aceptar/:entidadID', (req, res) => {
    const entidadID = req.params.entidadID;
    const query = 'UPDATE entidadReceptora SET estatus = "Aceptado" WHERE entidadID = ?';
  
    connection.query(query, [entidadID], (err, results) => {
      if (err) {
        return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
      }
      res.status(200).send({ message: 'Entidad aceptada con éxito' });
    });
});
  
  // Rechazar entidad
app.put('/entidadReceptora/rechazar/:entidadID', (req, res) => {
const entidadID = req.params.entidadID;
const query = 'UPDATE entidadReceptora SET estatus = "Rechazado" WHERE entidadID = ?';

connection.query(query, [entidadID], (err, results) => {
    if (err) {
    return res.status(500).send({ message: 'Error en el servidor: ' + err.message });
    }
    res.status(200).send({ message: 'Entidad rechazada con éxito' });
});
});

app.put('/vacantePractica/:id', (req, res) => {
    const { id } = req.params;
    const { titulo, fechaInicio, fechaFinal, ciudad, tipoTrabajo, descripcion } = req.body;
  
    if (!titulo || !fechaInicio || !fechaFinal || !ciudad || !tipoTrabajo || !descripcion) {
      return res.status(400).send({ message: 'Todos los campos son requeridos' });
    }
  
    const query = 'UPDATE vacantePractica SET titulo = ?, fechaInicio = ?, fechaFinal = ?, ciudad = ?, tipoTrabajo = ?, descripcion = ? WHERE vacantePracticaID = ?';
    const values = [titulo, fechaInicio, fechaFinal, ciudad, tipoTrabajo, descripcion, id];
  
    connection.query(query, values, (error, results) => {
      if (error) {
        console.error('Error updating vacante:', error);
        return res.status(500).send({ message: 'Error al actualizar la vacante', error: error.message });
      }
      if (results.affectedRows === 0) {
        return res.status(404).send({ message: 'Vacante no encontrada' });
      }
      res.status(200).send({ message: 'Vacante actualizada con éxito' });
    });
});