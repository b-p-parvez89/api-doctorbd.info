import mongoose from 'mongoose';
const schema=new mongoose.Schema({
 doctor:{type:mongoose.Schema.Types.ObjectId,ref:'Doctor',required:true},
 patient:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},
 appointment:{type:mongoose.Schema.Types.ObjectId,ref:'Appointment'},
 diagnosis:String,notes:String,medicines:[{name:String,dose:String,frequency:String,duration:String,instructions:String}]
},{timestamps:true});
export default mongoose.model('Prescription',schema);
