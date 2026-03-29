-- Init migration
CREATE TYPE "Role" AS ENUM ('admin', 'project_manager', 'safety_officer', 'viewer');
CREATE TYPE "CameraStatus" AS ENUM ('online', 'offline', 'maintenance');
CREATE TYPE "IncidentType" AS ENUM ('ppe_violation', 'fall_risk', 'restricted_zone_entry', 'machinery_hazard', 'near_miss');
CREATE TYPE "IncidentRiskLevel" AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE "IncidentStatus" AS ENUM ('open', 'acknowledged', 'resolved');
CREATE TYPE "IncidentAction" AS ENUM ('created', 'assigned', 'acknowledged', 'resolved', 'updated');
