import Notification from '../models/Notification.js';
export async function list(req,res){const limit=Math.min(Number(req.query.limit)||30,100);const items=await Notification.find({recipient:req.user.id}).sort({createdAt:-1}).limit(limit);const unread=await Notification.countDocuments({recipient:req.user.id,isRead:false});res.json({items,unread});}
export async function read(req,res){const n=await Notification.findOneAndUpdate({_id:req.params.id,recipient:req.user.id},{isRead:true},{new:true});if(!n)return res.status(404).json({message:'Notification not found'});res.json({notification:n});}
export async function readAll(req,res){await Notification.updateMany({recipient:req.user.id,isRead:false},{$set:{isRead:true}});res.json({ok:true});}
