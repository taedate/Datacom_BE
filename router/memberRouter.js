import express from "express";
import * as memC from '../controller/memberController.js'

const router = express.Router()
router.post('/register', memC.memberRegister)
router.post('/login',memC.memberLogin)
router.get('/authen', memC.memberAuthen)

export default router