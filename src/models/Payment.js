import mongoose from 'mongoose';
const schema=new mongoose.Schema({hospital:{type:mongoose.Schema.Types.ObjectId,ref:'Hospital'},hospitalName:String,amount:Number,method:String,reference:String,paymentDate:String,notes:String},{timestamps:true});
export default mongoose.model('Payment',schema);
