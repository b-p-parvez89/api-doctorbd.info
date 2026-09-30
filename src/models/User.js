import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  name:{type:String,required:true,trim:true},
  email:{type:String,required:true,unique:true,lowercase:true,trim:true},
  phone:{type:String,trim:true},
  passwordHash:{type:String},
  role:{type:String,enum:['patient','doctor','hospital','admin'],default:'patient'},
  avatar:String, gender:String, age:Number, address:String, city:String,
  active:{type:Boolean,default:true},
  phoneVerified:{type:Boolean,default:false},
  otpHash:String, otpExpiresAt:Date,
  resetOtpHash:String, resetOtpExpiresAt:Date, resetOtpVerifiedAt:Date
},{timestamps:true});
export default mongoose.model('User',schema);
