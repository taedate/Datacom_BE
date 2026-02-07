import express from "express";
import * as memC from '../controller/memberController.js'

const router = express.Router()
router.post('/register', memC.memberRegister)
router.post('/login',memC.memberLogin)
router.get('/authen', memC.memberAuthen)
router.post('/logout', memC.memberLogout)
router.get('/health-check', memC.systemHealthCheck)

export default router