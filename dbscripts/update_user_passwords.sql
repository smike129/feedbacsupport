ALTER TABLE system_user
ADD COLUMN password VARCHAR(255) NOT NULL;

UPDATE system_user SET password = '$2b$10$YFgdsCJC0d8y1kPIX.bOEOBicbxO/GTJx.P3hlAeq6m.0nyeQREtu'
 WHERE id = (14,15,16,17);





 CREATE DATABASE logindemo;
USE logindemo;
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL
);
INSERT INTO `users` (`id`, `username`, `password`)
VALUES ('1', 'user', '$2b$10$YFgdsCJC0d8y1kPIX.bOEOBicbxO/GTJx.P3hlAeq6m.0nyeQREtu');