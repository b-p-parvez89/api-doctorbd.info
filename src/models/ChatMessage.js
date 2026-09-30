import mongoose from 'mongoose';
const schema=new mongoose.Schema({
 sender:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},
 recipient:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},
 text:String,mediaUrl:String,mediaType:{type:String,enum:['image','video']},
 createdAt:{type:Date,default:Date.now}
});
schema.index({sender:1,recipient:1,createdAt:1});
export default mongoose.model('ChatMessage',schema);
