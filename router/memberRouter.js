import express from "express";
import * as memC from '../controller/memberController.js'

const router = express.Router()
router.post('/member/register', memC.memberRegister)
router.post('/member/login',memC.memberLogin)
router.get('/member/authen', memC.memberAuthen)

export default router