import Notification from '../models/Notification.js';
export async function notify(recipient,type,title,message,relatedId,relatedType){
 if(!recipient)return;
 try{await Notification.create({recipient,type,title,message,relatedId,relatedType});}catch(e){console.error('notification error',e.message);}
}
export async function notifyAdmins(type,title,message,relatedId,relatedType){
 const User=(await import('../models/User.js')).default;
 const admins=await User.find({role:'admin',active:true}).select('_id');
 await Promise.all(admins.map(a=>notify(a._id,type,title,message,relatedId,relatedType)));
}
