# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting on this repository ("Report a vulnerability" under the Security tab). You will get an acknowledgement within five working days.

## Scope

This repository contains the scoring engine, the metric catalogs and a local simulator. It runs no database connection and stores no data: it takes a map of collected values and returns a score. Collection is done by a separate project (the checker), which has its own policy.

The simulator is a development tool meant to run on a workstation or in an isolated container. It has no authentication and must not be exposed on a network. It listens on 127.0.0.1 by default, and the Docker compose file publishes its port on 127.0.0.1 only; setting `SIMULATOR_HOST` to another address is your decision and your exposure.

## Supported versions

Only the latest minor version of the package receives fixes.
