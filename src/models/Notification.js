import mongoose from 'mongoose';
const types=['NEW_DOCTOR','NEW_HOSPITAL','NEW_APPOINTMENT','APPOINTMENT_CONFIRMED','APPOINTMENT_REJECTED','APPOINTMENT_CANCELLED','APPOINTMENT_COMPLETED','DOCTOR_APPROVED','DOCTOR_REJECTED','HOSPITAL_APPROVED','HOSPITAL_REJECTED','NEW_MESSAGE','INCOMING_CALL','PRESCRIPTION_ADDED'];
const schema=new mongoose.Schema({
 recipient:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true,index:true},
 type:{type:String,enum:types,required:true},title:{type:String,required:true},message:{type:String,required:true},
 relatedId:mongoose.Schema.Types.ObjectId,relatedType:{type:String,enum:['Appointment','Doctor','Hospital','User','Prescription','Call']},
 isRead:{type:Boolean,default:false,index:true}
},{timestamps:true});
schema.index({recipient:1,createdAt:-1});
export default mongoose.model('Notification',schema);
