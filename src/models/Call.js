import mongoose from 'mongoose';
const schema=new mongoose.Schema({
 doctor:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},
 patient:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},
 type:{type:String,enum:['audio','video'],required:true},
 status:{type:String,enum:['ringing','accepted','rejected','ended'],default:'ringing'},
 roomId:{type:String,required:true,unique:true}
},{timestamps:true});
export default mongoose.model('Call',schema);
